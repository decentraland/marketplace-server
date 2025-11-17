import SQL, { SQLStatement } from 'sql-template-strings'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getWhereStatementFromFilters } from '../utils'
import { CollectionFilters, CollectionSortBy } from './types'

function getCollectionsSortByStatement(filters: CollectionFilters): SQLStatement {
  switch (filters.sortBy) {
    case CollectionSortBy.NEWEST:
      return SQL` ORDER BY created_at DESC `
    case CollectionSortBy.RECENTLY_REVIEWED:
      return SQL` ORDER BY reviewed_at DESC `
    case CollectionSortBy.NAME:
      return SQL` ORDER BY name ASC `
    case CollectionSortBy.SIZE:
      return SQL` ORDER BY items_count DESC `
    case CollectionSortBy.RECENTLY_LISTED:
      return SQL` ORDER BY first_listed_at DESC `
    default:
      return SQL` ORDER BY name ASC `
  }
}

function getCollectionsLimitAndOffsetStatement(filters: CollectionFilters): SQLStatement {
  const limit = filters?.first ? filters.first : 1000
  const offset = filters?.skip ? filters.skip : 0

  return SQL` LIMIT ${limit} OFFSET ${offset} `
}

function getCollectionsWhereStatement(filters: CollectionFilters): SQLStatement {
  const FILTER_BY_CONTRACT_ADDRESS = filters.contractAddress ? SQL`LOWER(id) = ${filters.contractAddress.toLowerCase()}` : null
  const FILTER_BY_CREATOR = filters.creator ? SQL`LOWER(creator) = ${filters.creator.toLowerCase()}` : null
  const FILTER_BY_URN = filters.urn ? SQL`urn = ${filters.urn}` : null
  const FILTER_BY_IS_ON_SALE = filters.isOnSale === true ? SQL`search_is_store_minter = true` : null
  const FILTER_BY_NAME = filters.name ? SQL`name = ${filters.name}` : null
  const FILTER_BY_SEARCH = filters.search ? SQL`search_text LIKE ${`%${filters.search.trim().toLowerCase()}%`}` : null
  const FILTER_BY_NETWORK = filters.network ? SQL`network = ${filters.network}` : null

  // If sorting by recently listed, filter out null values
  const FILTER_BY_RECENTLY_LISTED = filters.sortBy === CollectionSortBy.RECENTLY_LISTED ? SQL`first_listed_at IS NOT NULL` : null

  // Always apply the is_approved = true filter
  const FILTER_BY_IS_APPROVED = SQL`is_approved = true`

  return getWhereStatementFromFilters([
    FILTER_BY_CONTRACT_ADDRESS,
    FILTER_BY_CREATOR,
    FILTER_BY_URN,
    FILTER_BY_IS_ON_SALE,
    FILTER_BY_NAME,
    FILTER_BY_SEARCH,
    FILTER_BY_NETWORK,
    FILTER_BY_RECENTLY_LISTED,
    FILTER_BY_IS_APPROVED
  ])
}

export function getCollectionsQuery(filters: CollectionFilters): SQLStatement {
  return SQL`
    SELECT 
      id,
      owner,
      creator,
      name,
      symbol,
      is_completed,
      is_approved,
      is_editable,
      minters,
      managers,
      urn,
      items_count,
      created_at,
      updated_at,
      reviewed_at,
      first_listed_at,
      search_is_store_minter,
      search_text,
      base_uri,
      chain_id,
      network,
      COUNT(*) OVER() as count
    FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.collection`)
    .append(getCollectionsWhereStatement(filters))
    .append(getCollectionsSortByStatement(filters))
    .append(getCollectionsLimitAndOffsetStatement(filters))
}

export function getCollectionsCountQuery(filters: CollectionFilters): SQLStatement {
  return SQL`
    SELECT COUNT(*) as count
    FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.collection`)
    .append(getCollectionsWhereStatement(filters))
}
