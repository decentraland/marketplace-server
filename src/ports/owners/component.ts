import { PoolClient } from 'pg'
import { AppComponents } from '../../types'
import { getOwnersQuery } from './queries'
import { IOwnersComponent, OwnerCountDBRow, OwnerDBRow, OwnersFilters, OwnersSortBy } from './types'

export const BAD_REQUEST_ERROR_MESSAGE = "Couldn't fetch owners with the filters provided"

export function createOwnersComponent(options: { dappsDatabase: Pick<AppComponents, 'dappsDatabase'>['dappsDatabase'] }): IOwnersComponent {
  const { dappsDatabase } = options

  async function fetchAndCount(
    filters: OwnersFilters & {
      sortBy?: OwnersSortBy
      first?: number
      skip?: number
    }
  ) {
    if (filters.itemId === undefined || !filters.contractAddress) {
      throw new Error('itemId and contractAddress are necessary params.')
    }

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
      throw new Error(BAD_REQUEST_ERROR_MESSAGE)
    } finally {
      client?.release()
    }
  }

  return {
    fetchAndCount
  }
}
