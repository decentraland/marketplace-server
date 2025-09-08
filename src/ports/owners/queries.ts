import SQL from 'sql-template-strings'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { OwnersFilters, OwnersSortBy } from './types'

export const OWNERS_QUERY_DEFAULT_OFFSET = 0
export const OWNERS_QUERY_DEFAULT_LIMIT = 20

export const getOwnersQuery = (
  filters: OwnersFilters & {
    sortBy?: OwnersSortBy
    first?: number
    skip?: number
  },
  isCount = false
) => {
  const { contractAddress, skip, first, sortBy, itemId } = filters

  const fields = isCount ? SQL`COUNT(*)` : SQL`nft.issued_id, account.address as owner, nft.token_id`

  const query = SQL`SELECT `
    .append(fields)
    .append(` FROM `)
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(`.nft AS nft`)
    .append(` LEFT JOIN `)
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(`.account AS account ON nft.owner_id = account.id`)

  const where = [
    contractAddress ? SQL`nft.contract_address = ${contractAddress}` : undefined,
    itemId ? SQL`nft.item_blockchain_id = ${itemId}` : undefined
  ].filter(Boolean)

  if (where.length) {
    query.append(` WHERE `)
    where.forEach((whereClause, index) => {
      if (whereClause) {
        query.append(whereClause)
        if (index < where.length - 1) {
          query.append(` AND `)
        }
      }
    })
  }

  if (!isCount) {
    if (sortBy) {
      switch (sortBy) {
        case OwnersSortBy.ISSUED_ID:
          query.append(SQL` ORDER BY nft.issued_id`)
          break
        default:
          break
      }
      query.append(filters.orderDirection === 'asc' ? SQL` ASC` : SQL` DESC`)
    }
    query.append(skip !== undefined ? SQL` OFFSET ${skip}` : SQL` OFFSET ${OWNERS_QUERY_DEFAULT_OFFSET}`)

    query.append(first !== undefined ? SQL` LIMIT ${first}` : SQL` LIMIT ${OWNERS_QUERY_DEFAULT_LIMIT}`)
  }

  return query
}
