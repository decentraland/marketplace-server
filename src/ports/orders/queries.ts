import SQL, { SQLStatement } from 'sql-template-strings'
import { OrderFilters, OrderSortBy } from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getDBNetworks } from '../../utils'
import { getTradesCTE } from '../catalog/queries'
import { getWhereStatementFromFilters } from '../utils'

function getOrdersSortByStatement(filters: OrderFilters): SQLStatement {
  switch (filters.sortBy) {
    case OrderSortBy.OLDEST:
      return SQL` ORDER BY created_at ASC `
    case OrderSortBy.RECENTLY_LISTED:
      return SQL` ORDER BY created_at DESC `
    case OrderSortBy.RECENTLY_UPDATED:
      return SQL` ORDER BY updated_at DESC `
    case OrderSortBy.CHEAPEST:
      return SQL` ORDER BY price ASC `
    case OrderSortBy.ISSUED_ID_ASC:
      return SQL` ORDER BY token_id ASC `
    case OrderSortBy.ISSUED_ID_DESC:
      return SQL` ORDER BY token_id DESC `
    default:
      return SQL` ORDER BY created_at DESC `
  }
}

function getOrdersLimitAndOffsetStatement(filters: OrderFilters) {
  const limit = filters?.first ? filters.first : 1000
  const offset = filters?.skip ? filters.skip : 0

  return SQL` LIMIT ${limit} OFFSET ${offset} `
}

function getInnerOrdersLimitAndOffsetStatement(filters: OrderFilters) {
  const finalLimit = filters?.first ? filters.first : 1000
  const finalOffset = filters?.skip ? filters.skip : 0

  // For inner queries, we need to fetch enough records to account for the final offset
  // and potential records from the other UNION part
  const innerLimit = finalLimit + finalOffset

  return SQL` LIMIT ${innerLimit}`
}

export function getTradesOrdersQuery(filters: OrderFilters & { nftIds?: string[] }): SQLStatement {
  return SQL`
    SELECT
      id::text,
      id::text as trade_id,
      trade_contract as marketplace_address,
      sent_nft_category as category,
      contract_address_sent as nft_address,
      (sent_token_id)::numeric(78) as token_id,
      (amount_received)::numeric(78) as price,
      sent_item_id as item_id,
      (assets -> 'sent' ->> 'issued_id')::numeric(78) as issued_id,
      assets -> 'sent' ->> 'nft_id' as nft_id,
      assets -> 'sent' ->> 'nft_name' as nft_name,
      assets -> 'sent' ->> 'owner' as owner,
      '' as buyer,
      '' as tx_hash,
      0 as block_number,
      status,
      EXTRACT(EPOCH FROM created_at) as created_at,
      EXTRACT(EPOCH FROM created_at) as updated_at,
      EXTRACT(EPOCH FROM expires_at) as expires_at,
      network
    FROM (`
    .append(SQL`SELECT * FROM unified_trades WHERE type = 'public_nft_order' AND status = 'open'`)
    .append(filters.nftIds ? SQL` AND sent_nft_id = ANY(${filters.nftIds})` : SQL``)
    .append(filters.owner ? SQL` AND signer = ${filters.owner.toLowerCase()}` : SQL``)
    .append(SQL`) as trades WHERE signer = assets -> 'sent' ->> 'owner'`)
}

export function getLegacyOrdersQuery(): string {
  return `
    SELECT
      ord.id::text,
      '' as trade_id,
      ord.marketplace_address,
      ord.category,
      ord.nft_address,
      ord.token_id,
      ord.price,
      ord.item_id,
      nft.issued_id,
      ord.nft_id,
      nft.name as nft_name,
      ord.owner,
      ord.buyer,
      ord.tx_hash,
      ord.block_number,
      ord.status,
      ord.created_at,
      ord.updated_at,
      ord.expires_at,
      ord.network
    FROM ${MARKETPLACE_SQUID_SCHEMA}."order" ord
    JOIN ${MARKETPLACE_SQUID_SCHEMA}."nft" nft ON ord.nft_id = nft.id AND nft.owner_address = ord.owner`
}

export interface OrderQueries {
  orderTradesQuery: SQLStatement
  legacyOrdersQuery: SQLStatement
}

function getOrdersAndTradesFilters(filters: OrderFilters & { nftIds?: string[] }) {
  const FILTER_BY_MARKETPLACE_ADDRESS = filters.marketplaceAddress
    ? SQL` LOWER(marketplace_address) = LOWER(${filters.marketplaceAddress}) `
    : null
  const FILTER_BY_OWNER = filters.owner ? SQL` LOWER(owner) = LOWER(${filters.owner}) ` : null
  const FILTER_BY_BUYER = filters.buyer ? SQL` LOWER(buyer) = LOWER(${filters.buyer}) ` : null
  const FILTER_BY_CONTRACT_ADDRESS = filters.contractAddress ? SQL` LOWER(nft_address) = LOWER(${filters.contractAddress}) ` : null
  const FILTER_BY_TOKEN_ID = filters.tokenId ? SQL` token_id = ${filters.tokenId} ` : null
  const FILTER_BY_STATUS = filters.status ? SQL` status = ${filters.status} ` : null
  const FILTER_BY_NETWORK = filters.network ? SQL` network = ANY(${getDBNetworks(filters.network)}) ` : null
  // L1 item_ids are in the format of 0x32b7495895264ac9d0b12d32afd435453458b1c6-cw_casinovisor_hat
  const itemId = filters.itemId ? (filters.itemId.includes('-') ? filters.itemId : `${filters.contractAddress}-${filters.itemId}`) : null
  const FILTER_ORDER_BY_ITEM_ID = itemId ? SQL` ord.item_id = ${itemId} ` : null
  const FILTER_TRADE_BY_ITEM_ID = filters.itemId ? SQL` item_id = ${filters.itemId} ` : null
  const FILTER_BY_NFT_ID = filters.nftIds ? SQL` nft_id = ANY(${filters.nftIds}) ` : null
  const FILTER_ORDER_NOT_EXPIRED = SQL` expires_at_normalized > NOW() `
  const FILTER_TRADE_NOT_EXPIRED = SQL` expires_at > EXTRACT(EPOCH FROM now()::timestamptz(3)) `

  const COMMON_FILTERS = [
    FILTER_BY_MARKETPLACE_ADDRESS,
    FILTER_BY_OWNER,
    FILTER_BY_BUYER,
    FILTER_BY_CONTRACT_ADDRESS,
    FILTER_BY_TOKEN_ID,
    FILTER_BY_STATUS,
    FILTER_BY_NETWORK,
    FILTER_BY_NFT_ID
  ]
  return {
    orders: [...COMMON_FILTERS, FILTER_ORDER_BY_ITEM_ID, FILTER_ORDER_NOT_EXPIRED],
    trades: [...COMMON_FILTERS, FILTER_TRADE_BY_ITEM_ID, FILTER_TRADE_NOT_EXPIRED]
  }
}

export function getOrderAndTradeQueries(filters: OrderFilters & { nftIds?: string[] }): OrderQueries {
  const { orders: ordersFilters, trades: tradesFilters } = getOrdersAndTradesFilters(filters)

  const commonQueryParts = getOrdersSortByStatement(filters).append(getInnerOrdersLimitAndOffsetStatement(filters))

  const orderTradesQuery = SQL`SELECT *, COUNT(*) OVER() as count `
    .append(SQL`FROM (`)
    .append(getTradesOrdersQuery(filters))
    .append(SQL`) as order_trades`)
    .append(getWhereStatementFromFilters(tradesFilters))
    .append(commonQueryParts)

  const legacyOrdersQuery = SQL`SELECT *, COUNT(*) OVER() as count `
    .append(SQL`FROM (`)
    .append(getLegacyOrdersQuery())
    .append(getWhereStatementFromFilters(ordersFilters))
    .append(SQL`) as legacy_orders`)
    .append(commonQueryParts)

  return {
    orderTradesQuery,
    legacyOrdersQuery
  }
}

// The original getOrdersQuery can now use the new function if needed
export function getOrdersQuery(filters: OrderFilters & { nftIds?: string[] }, prefix = 'combined_orders'): SQLStatement {
  const { orderTradesQuery, legacyOrdersQuery } = getOrderAndTradeQueries(filters)

  const { first, skip } = filters
  return getTradesCTE({ first, skip }).append(
    SQL`
    SELECT `
      .append(prefix)
      .append(
        SQL`.* FROM (
      (`
          .append(orderTradesQuery)
          .append(
            SQL`)
      UNION ALL
      (`
              .append(legacyOrdersQuery)
              .append(
                SQL`)
    ) as `
              )
              .append(prefix)
              .append(getOrdersSortByStatement(filters).append(getOrdersLimitAndOffsetStatement(filters)))
          )
      )
  )
}

export function getOrdersCountQuery(filters: OrderFilters & { nftIds?: string[] }): SQLStatement {
  const { orders: ordersFilters, trades: tradesFilters } = getOrdersAndTradesFilters(filters)

  return getTradesCTE({ first: filters.first, skip: filters.skip }).append(
    SQL`
    ,aggregated_counts AS (
      SELECT 
        SUM(COALESCE(trades_count, 0)) AS total_trades,
        SUM(COALESCE(orders_count, 0)) AS total_orders
      FROM (
        -- Trades Count
        SELECT COUNT(*) AS trades_count, 
               NULL::bigint AS orders_count
        FROM (
          SELECT *, 
                 COUNT(*) OVER() AS trades_count
          FROM (
            `
      .append(getTradesOrdersQuery(filters))
      .append(
        SQL`
          ) AS trades_filtered
          `
          .append(getWhereStatementFromFilters(tradesFilters))
          .append(
            SQL`
        ) AS trades_final
        
        UNION ALL
        
        -- Orders Count
        SELECT NULL::bigint AS trades_count, 
               COUNT(*) AS orders_count
        FROM (
          SELECT id
          FROM `
              .append(MARKETPLACE_SQUID_SCHEMA)
              .append(
                SQL`."order" as ord
          `.append(getWhereStatementFromFilters(ordersFilters)).append(SQL`
        ) AS orders_filtered
      ) AS counts_combined
    )
    SELECT *,
           (SELECT total_trades + total_orders FROM aggregated_counts) AS count
    FROM (
      SELECT *
      FROM   aggregated_counts
    ) AS combined_counts
  `)
              )
          )
      )
  )
}
