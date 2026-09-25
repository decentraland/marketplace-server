import { PoolClient } from 'pg'
import SQL from 'sql-template-strings'
import { isErrorWithMessage } from '../../logic/errors'
import { AppComponents } from '../../types'
import { TopOwnersTimeoutError } from './errors'
import { getOwnersQuery, getTopOwnersQuery } from './queries'
import {
  IOwnersComponent,
  OwnerCountDBRow,
  OwnerDBRow,
  OwnersFilters,
  OwnersSortBy,
  TopOwner,
  TopOwnerDBRow,
  TopOwnersFilters
} from './types'
import { fromTopOwnerDBRow, rankTopOwners } from './utils'

export const BAD_REQUEST_ERROR_MESSAGE = "Couldn't fetch owners with the filters provided"

// Holders change slowly next to how often a dashboard is reloaded, and the aggregate is the expensive part.
export const TOP_OWNERS_CACHE_TTL_SECONDS = 600
// A creator with hundreds of thousands of NFTs takes several seconds to aggregate; past this, the request
// fails fast instead of holding a pooled connection for the pool's full statement timeout.
export const TOP_OWNERS_STATEMENT_TIMEOUT_MS = 5000
const QUERY_CANCELED = '57014'

function hasPgCode(e: unknown): e is { code: string } {
  return typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string'
}

/**
 * Creates the owners component: who holds a given item, and who holds a creator's items overall.
 *
 * @param options - The read database, the logger factory, and the cache the per-creator aggregate lives in.
 * @returns The owners component.
 */
export function createOwnersComponent(options: {
  dappsDatabase: Pick<AppComponents, 'dappsDatabase'>['dappsDatabase']
  logs: Pick<AppComponents, 'logs'>['logs']
  cache: Pick<AppComponents, 'cache'>['cache']
}): IOwnersComponent {
  const { dappsDatabase, logs, cache } = options
  const logger = logs.getLogger('Owners component')

  async function fetchAndCount(
    filters: OwnersFilters & {
      sortBy?: OwnersSortBy
      first?: number
      skip?: number
    }
  ) {
    let client: PoolClient | undefined = undefined
    try {
      client = await dappsDatabase.getPool().connect()

      const ownersQuery = getOwnersQuery(filters)
      const ownersCountQuery = getOwnersQuery(filters, true)

      const [owners, ownersCount] = await Promise.all([
        client.query<OwnerDBRow>(ownersQuery),
        client.query<OwnerCountDBRow>(ownersCountQuery)
      ])

      const results = owners.rows.map((owner: OwnerDBRow) => ({
        issuedId: owner.issued_id,
        ownerId: owner.owner,
        tokenId: owner.token_id
      }))

      return {
        data: results,
        total: Number(ownersCount.rows[0].count)
      }
    } catch (e) {
      logger.error(`Couldn't fetch owners with the filters provided: ${isErrorWithMessage(e) ? e.message : 'Unknown'}`)
      throw new Error(BAD_REQUEST_ERROR_MESSAGE)
    } finally {
      client?.release()
    }
  }

  /**
   * Aggregates every owner of the creator's items, bounded by a statement timeout.
   *
   * @param creator - The creator's address, lowercased.
   * @returns Every owner, unsorted.
   * @throws TopOwnersTimeoutError when the aggregate does not finish within the timeout.
   */
  async function aggregateTopOwners(creator: string): Promise<TopOwner[]> {
    const client = await dappsDatabase.getPool().connect()
    // Set when the connection cannot be trusted back in the pool: released with it, node-postgres destroys it.
    let broken: Error | undefined
    try {
      await client.query('BEGIN')
      // set_config(..., true) is SET LOCAL with a bound parameter, so the value never reaches the SQL text.
      await client.query(SQL`SELECT set_config('statement_timeout', ${String(TOP_OWNERS_STATEMENT_TIMEOUT_MS)}, true)`)
      const result = await client.query<TopOwnerDBRow>(getTopOwnersQuery(creator))
      await client.query('COMMIT')
      return result.rows.map(fromTopOwnerDBRow)
    } catch (e) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError) {
        broken = rollbackError instanceof Error ? rollbackError : new Error('ROLLBACK failed')
      }
      if (hasPgCode(e) && e.code === QUERY_CANCELED) throw new TopOwnersTimeoutError(creator)
      throw e
    } finally {
      client.release(broken)
    }
  }

  async function fetchTopOwners(filters: TopOwnersFilters): Promise<{ data: TopOwner[]; total: number }> {
    const creator = filters.creator.toLowerCase()
    const cacheKey = `top-owners:${creator}`
    // The cache is an optimisation: an unreachable one costs a recomputation, never the answer.
    let owners = await cache.get<TopOwner[]>(cacheKey).catch((e: unknown) => {
      logger.warn(`Couldn't read the cached owners of ${creator}: ${isErrorWithMessage(e) ? e.message : 'Unknown'}`)
      return null
    })
    if (!owners) {
      try {
        owners = await aggregateTopOwners(creator)
      } catch (e) {
        logger.error(`Couldn't aggregate the owners of ${creator}: ${isErrorWithMessage(e) ? e.message : 'Unknown'}`)
        throw e
      }
      await cache.set(cacheKey, owners, TOP_OWNERS_CACHE_TTL_SECONDS).catch((e: unknown) => {
        logger.warn(`Couldn't cache the owners of ${creator}: ${isErrorWithMessage(e) ? e.message : 'Unknown'}`)
      })
    }
    return rankTopOwners(owners, filters)
  }

  return {
    fetchAndCount,
    fetchTopOwners
  }
}
