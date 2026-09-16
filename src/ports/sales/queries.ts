import SQL, { SQLStatement } from 'sql-template-strings'
import { SaleFilters, SaleSortBy } from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getDBNetworks } from '../../utils'
import { getWhereStatementFromFilters } from '../utils'
import { SalesSummaryFilters } from './types'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000

function getSalesLimitAndOffsetStatement(filters: SaleFilters) {
  const limit = filters?.first ? Math.min(filters.first, MAX_LIMIT) : DEFAULT_LIMIT
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
    FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.sale
    `.append(getLegacySalesQueryWhereStatement(filters))
    )
}

export function getSalesQuery(filters: SaleFilters = {}) {
  const LEGACY_SALES = SQL`(`.append(getLegacySalesQuery(filters)).append(SQL` ) as legacy_sales `)

  return SQL`SELECT *, COUNT(*) OVER() as sales_count`
    .append(SQL` FROM `)
    .append(LEGACY_SALES)
    .append(getSalesSortByStatement(filters.sortBy))
    .append(getSalesLimitAndOffsetStatement(filters))
}

// Keep the bounds in seconds so PostgreSQL can use the sale timestamp index.
function getSummaryWindow({ from, to }: SalesSummaryFilters) {
  const window = SQL``
  if (from !== undefined) window.append(SQL` AND timestamp >= ${from}::numeric / 1000 `)
  if (to !== undefined) window.append(SQL` AND timestamp <= ${to}::numeric / 1000 `)
  return window
}

export function getSalesSummaryQuery(filters: SalesSummaryFilters) {
  const seller = filters.seller.toLowerCase()
  return SQL`WITH seller_sales AS (
    SELECT type, price, timestamp, search_contract_address, search_item_id
    FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.sale WHERE seller = ${seller}
  ), window_sales AS (
    SELECT * FROM seller_sales WHERE TRUE `
    )
    .append(getSummaryWindow(filters))
    .append(
      SQL`
  ), collections AS (
    SELECT search_contract_address, COUNT(*) AS sold, SUM(price)::text AS earned
    FROM window_sales GROUP BY search_contract_address
  ), items AS (
    SELECT search_contract_address, search_item_id, COUNT(*) AS sold
    FROM seller_sales
    WHERE type = 'mint' AND search_item_id IS NOT NULL
    GROUP BY search_contract_address, search_item_id
  ), royalties AS (
    SELECT COUNT(*) AS resales, COALESCE(SUM(price), 0)::text AS volume
    FROM `
    )
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.sale s
    WHERE s.type IN ('order', 'bid')
      AND EXISTS (
        SELECT 1 FROM `
    )
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.item i
        WHERE i.id = s.item_id AND LOWER(i.creator) = ${seller}
      ) `
    )
    .append(getSummaryWindow(filters)).append(SQL`
  )
  SELECT json_build_object(
    'total', COUNT(*),
    'mints', COUNT(*) FILTER (WHERE type = 'mint'),
    'resales', COUNT(*) FILTER (WHERE type IN ('order', 'bid')),
    'earnedWei', COALESCE(SUM(price), 0)::text,
    'byCollection', (SELECT COALESCE(json_agg(json_build_object(
      'contractAddress', search_contract_address, 'sold', sold, 'earnedWei', earned
    ) ORDER BY search_contract_address), '[]'::json) FROM collections),
    'byItem', (SELECT COALESCE(json_agg(json_build_object(
      'contractAddress', search_contract_address, 'itemId', search_item_id::text, 'soldLifetime', sold
    ) ORDER BY search_contract_address, search_item_id), '[]'::json) FROM items),
    'royalties', (SELECT json_build_object('resales', resales, 'volumeWei', volume) FROM royalties)
  ) AS summary FROM window_sales`)
}
