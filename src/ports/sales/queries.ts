import SQL, { SQLStatement } from 'sql-template-strings'
import { SaleFilters, SaleSortBy } from '@dcl/schemas'
import { getDBNetworks } from '../../utils'
import { getWhereStatementFromFilters } from '../utils'

const DEFAULT_LIMIT = 100

function getSalesLimitAndOffsetStatement(filters: SaleFilters) {
  const limit = filters?.first ? filters.first : DEFAULT_LIMIT
  const offset = filters?.skip ? filters.skip : 0

  return SQL` LIMIT ${limit} OFFSET ${offset} `
}

function getSalesSortByStatement(sortBy?: SaleSortBy) {
  switch (sortBy) {
    case SaleSortBy.MOST_EXPENSIVE:
      return SQL` ORDER BY price DESC `
    case SaleSortBy.RECENTLY_SOLD:
      return SQL` ORDER BY timestamp DESC `
    default:
      return SQL` ORDER BY timestamp DESC `
  }
}

function getLegacySalesQueryWhereStatement(filters: SaleFilters): SQLStatement {
  const FILTER_BY_TYPE = filters.type ? SQL` type = ${filters.type} ` : null
  const FILTER_BY_BUYER = filters.buyer ? SQL` buyer = ${filters.buyer} ` : null
  const FILTER_BY_SELLER = filters.seller ? SQL` seller = ${filters.seller.toLowerCase()} ` : null
  const FILTER_BY_CONTRACT_ADDRESS = filters.contractAddress
    ? SQL` search_contract_address = ${filters.contractAddress.toLowerCase()} `
    : null
  const FILTER_BY_ITEM_ID = filters.itemId ? SQL` search_item_id = ${filters.itemId} ` : null
  const FILTER_BY_TOKEN_ID = filters.tokenId ? SQL` search_token_id = ${filters.tokenId} ` : null
  const FILTER_BY_NETWORK = filters.network ? SQL` network = ANY (${getDBNetworks(filters.network)}) ` : null
  const FILTER_BY_MIN_PRICE = filters.minPrice ? SQL` price >= ${filters.minPrice} ` : null
  const FILTER_BY_MAX_PRICE = filters.maxPrice ? SQL` price <= ${filters.maxPrice} ` : null
  const FILTER_BY_CATEGORY = filters.categories && filters.categories.length ? SQL` search_category = ANY (${filters.categories}) ` : null
  const FILTER_FROM_TIMESTAMP = filters.from ? SQL` (timestamp * 1000) >= ${filters.from} ` : null
  const FILTER_TO_TIMESTAMP = filters.to ? SQL` (timestamp * 1000) <= ${filters.to} ` : null

  return getWhereStatementFromFilters([
    FILTER_BY_TYPE,
    FILTER_BY_BUYER,
    FILTER_BY_SELLER,
    FILTER_BY_CONTRACT_ADDRESS,
    FILTER_BY_ITEM_ID,
    FILTER_BY_TOKEN_ID,
    FILTER_BY_NETWORK,
    FILTER_BY_MIN_PRICE,
    FILTER_BY_MAX_PRICE,
    FILTER_BY_CATEGORY,
    FILTER_FROM_TIMESTAMP,
    FILTER_TO_TIMESTAMP
  ])
}

function getLegacySalesQuery(filters: SaleFilters): SQLStatement {
  return SQL`
    SELECT
      id,
      type,
      buyer,
      seller,
      search_item_id::text as item_id,
      search_token_id::text as token_id,
      search_contract_address as contract_address,
      price,
      (timestamp * 1000) as timestamp,
      tx_hash,
      network,
      search_category as category
    FROM squid_marketplace.sale
    `.append(getLegacySalesQueryWhereStatement(filters))
}

export function getSalesQuery(filters: SaleFilters = {}) {
  const LEGACY_SALES = SQL`(`.append(getLegacySalesQuery(filters)).append(SQL` ) as legacy_sales `)

  return SQL`SELECT *, COUNT(*) OVER() as sales_count`
    .append(SQL` FROM `)
    .append(LEGACY_SALES)
    .append(getSalesSortByStatement(filters.sortBy))
    .append(getSalesLimitAndOffsetStatement(filters))
}
