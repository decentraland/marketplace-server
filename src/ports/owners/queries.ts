import SQL from 'sql-template-strings'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { OwnersFilters, OwnersSortBy } from './types'

export const OWNERS_QUERY_DEFAULT_OFFSET = 0
export const OWNERS_QUERY_DEFAULT_LIMIT = 20
export const OWNERS_QUERY_MAX_LIMIT = 1000

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
    .append(' FROM ')
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append('.nft AS nft')
    .append(' LEFT JOIN ')
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append('.account AS account ON nft.owner_id = account.id')

  const where = [
    contractAddress ? SQL`nft.contract_address = ${contractAddress}` : undefined,
    itemId ? SQL`nft.item_blockchain_id = ${itemId}` : undefined
  ].filter(Boolean)

  if (where.length) {
    query.append(' WHERE ')
    where.forEach((whereClause, index) => {
      if (whereClause) {
        query.append(whereClause)
        if (index < where.length - 1) {
          query.append(' AND ')
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

    query.append(first !== undefined ? SQL` LIMIT ${Math.min(first, OWNERS_QUERY_MAX_LIMIT)}` : SQL` LIMIT ${OWNERS_QUERY_DEFAULT_LIMIT}`)
  }

  return query
}

/**
 * Every account holding NFTs of a creator's items, with what it holds and what it paid for them.
 *
 * Unpaged on purpose: the result is cached per creator and sorted and paged in memory, so every sort order
 * costs one aggregate rather than one per page. The creator is matched lowercased, like every other creator
 * filter here, because the indexer stores addresses as it finds them. The creator's own holdings and the
 * zero address are left out: neither is a customer.
 */
export const getTopOwnersQuery = (creator: string) => {
  const address = creator.toLowerCase()
  return SQL`WITH creator_items AS (
    SELECT id FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.item WHERE LOWER(creator) = ${address}
  ), owners AS (
    SELECT n.owner_address AS owner, COUNT(*) AS nfts, COUNT(DISTINCT n.item_id) AS items,
      COUNT(DISTINCT n.contract_address) AS collections,
      -- Per NFT first: an issued copy that never moved has no transfer, and its mint is when it arrived.
      MAX(COALESCE(n.transferred_at, n.created_at, 0)) AS last_at
    FROM `
    )
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.nft n
    WHERE n.item_id IN (SELECT id FROM creator_items)
      AND n.owner_address <> ${address}
      AND n.owner_address <> '0x0000000000000000000000000000000000000000'
    GROUP BY n.owner_address
  ), spent AS (
    SELECT s.buyer AS owner, SUM(s.price) AS spent
    FROM `
    )
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.sale s
    WHERE s.item_id IN (SELECT id FROM creator_items)
      AND s.buyer IN (SELECT owner FROM owners)
    GROUP BY s.buyer
  )
  SELECT o.owner, o.nfts::text, o.items::text, o.collections::text, o.last_at::text, COALESCE(sp.spent, 0)::text AS spent
  FROM owners o LEFT JOIN spent sp ON sp.owner = o.owner`
    )
}
