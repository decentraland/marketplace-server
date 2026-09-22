import {
  CREATOR_SEARCH_DEFAULT_LIMIT,
  CREATOR_SEARCH_MAX_LENGTH,
  CREATOR_SEARCH_MAX_LIMIT,
  CreatorSearchRow,
  getCreatorSearchQuery,
  parseCatalystProfiles,
  refreshCreatorProfiles
} from '../../logic/catalog/creator-profiles'
import { rebuildSearchTables } from '../../logic/catalog/search-words-table'
import { AppComponents } from '../../types'
import { clampCount } from '../shop-catalog/component'
import {
  CREATOR_PROFILES_LOOKUP_TIMEOUT_MS,
  CreatorSearchFilters,
  CreatorSearchHit,
  DEFAULT_PEER_URL,
  ICreatorProfilesComponent
} from './types'

export async function createCreatorProfilesComponent(
  components: Pick<AppComponents, 'config' | 'logs' | 'fetch' | 'dappsDatabase' | 'dappsWriteDatabase'>
): Promise<ICreatorProfilesComponent> {
  const { config, logs, fetch, dappsDatabase, dappsWriteDatabase } = components
  const logger = logs.getLogger('creator-profiles')
  const peerUrl = ((await config.getString('PEER_URL')) || DEFAULT_PEER_URL).replace(/\/+$/, '')

  async function fetchProfiles(addresses: string[]) {
    const response = await fetch.fetch(`${peerUrl}/lambdas/profiles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ids: addresses }),
      signal: AbortSignal.timeout(CREATOR_PROFILES_LOOKUP_TIMEOUT_MS)
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`Catalyst answered ${response.status}`)
    }
    return parseCatalystProfiles(await response.json())
  }

  async function refresh() {
    const result = await refreshCreatorProfiles({
      connect: () => dappsWriteDatabase.getPool().connect(),
      fetchProfiles,
      logger
    })
    if (result.outcome === 'refreshed') {
      logger.info(`Refreshed ${result.creators} creator profiles: ${result.lookedUp} looked up, ${result.failedBatches} batches failed`)
      await rebuildNow()
    }
    return result
  }

  // The words tables are what the search reads, and their scheduled rebuild is up to five minutes away.
  // Best effort: the rebuild takes its own lock and skips if the catalog job holds it, and a failure here
  // only means the scheduled rebuild picks the new profiles up instead.
  async function rebuildNow() {
    const client = await dappsWriteDatabase.getPool().connect()
    try {
      const outcome = await rebuildSearchTables(client)
      logger.info(`Search tables ${outcome} after the creator profiles refresh`)
    } catch (error) {
      logger.warn(`Could not rebuild the search tables after the refresh: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      client.release()
    }
  }

  async function search(filters: CreatorSearchFilters): Promise<{ data: CreatorSearchHit[] }> {
    const first = clampCount(filters.first, CREATOR_SEARCH_DEFAULT_LIMIT, 1, CREATOR_SEARCH_MAX_LIMIT)
    const search = filters.search.trim().slice(0, CREATOR_SEARCH_MAX_LENGTH)
    if (!search) return { data: [] }
    const result = await dappsDatabase.query<CreatorSearchRow>(getCreatorSearchQuery(search, first))
    return {
      data: result.rows.map(row => ({
        address: row.address,
        name: row.name,
        face: row.face,
        items: Number(row.items),
        collections: Number(row.collections)
      }))
    }
  }

  return { refresh, search }
}
