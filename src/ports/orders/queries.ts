import SQL, { SQLStatement } from 'sql-template-strings'
import { OrderFilters, OrderSortBy, TradeType } from '@dcl/schemas'
import { ContractName, getContract } from 'decentraland-transactions'
import { getEthereumChainId, getPolygonChainId } from '../../logic/chainIds'
import { getDBNetworks } from '../../utils'
import { MAX_ORDER_TIMESTAMP } from '../catalog/queries'
import { getTradesForTypeQuery } from '../trades/queries'
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
  const limit = filters?.first ? filters.first : 100
  const offset = filters?.skip ? filters.skip : 0

  return SQL` LIMIT ${limit} OFFSET ${offset} `
}

function getInnerOrdersLimitAndOffsetStatement(filters: OrderFilters) {
  const finalLimit = filters?.first ? filters.first : 100
  const finalOffset = filters?.skip ? filters.skip : 0

  // For inner queries, we need to fetch enough records to account for the final offset
  // and potential records from the other UNION part
  const innerLimit = finalLimit + finalOffset

  return SQL` LIMIT ${innerLimit}`
}

export function getTradesOrdersQuery(): string {
  const marketplacePolygon = getContract(ContractName.OffChainMarketplace, getPolygonChainId())
  const marketplaceEthereum = getContract(ContractName.OffChainMarketplace, getEthereumChainId())

  return `
    SELECT
      id::text,
      id::text as trade_id,
      CASE
        WHEN LOWER(network) = 'matic' then '${marketplacePolygon.address}'
        ELSE '${marketplaceEthereum.address}'
      END AS marketplace_address,
      assets -> 'sent' ->> 'category' as category,
      assets -> 'sent' ->> 'contract_address' as nft_address,
      (assets -> 'sent' ->> 'token_id')::numeric(78) as token_id,
      (assets -> 'received' ->> 'amount')::numeric(78) as price,
      assets -> 'sent' ->> 'item_id' as item_id,
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
    FROM (${getTradesForTypeQuery(TradeType.PUBLIC_NFT_ORDER)}) as trades`
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
    FROM squid_marketplace."order" ord
    JOIN squid_marketplace."nft" nft ON ord.nft_id = nft.id`
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
  const FILTER_ORDER_BY_ITEM_ID = filters.itemId ? SQL` item_id = ${`${filters.contractAddress}-${filters.itemId}`} ` : null
  const FILTER_TRADE_BY_ITEM_ID = filters.itemId ? SQL` item_id = ${filters.itemId} ` : null
  const FILTER_BY_NFT_NAME = filters.nftName ? SQL` LOWER(nft_name) = LOWER(${filters.nftName}) ` : null
  const FILTER_BY_NFT_ID = filters.nftIds ? SQL` nft_id = ANY(${filters.nftIds}) ` : null
  const FILTER_NOT_EXPIRED = SQL` expires_at < `.append(MAX_ORDER_TIMESTAMP).append(
    SQL` AND ((LENGTH(expires_at::text) = 13 AND TO_TIMESTAMP(expires_at / 1000.0) > NOW())
                      OR
              (LENGTH(expires_at::text) = 10 AND TO_TIMESTAMP(expires_at) > NOW())) `
  )

  const COMMON_FILTERS = [
    FILTER_BY_MARKETPLACE_ADDRESS,
    FILTER_BY_OWNER,
    FILTER_BY_BUYER,
    FILTER_BY_CONTRACT_ADDRESS,
    FILTER_BY_TOKEN_ID,
    FILTER_BY_STATUS,
    FILTER_BY_NETWORK,
    FILTER_BY_NFT_NAME,
    FILTER_BY_NFT_ID,
    FILTER_NOT_EXPIRED
  ]
  return {
    orders: [...COMMON_FILTERS, FILTER_ORDER_BY_ITEM_ID],
    trades: [...COMMON_FILTERS, FILTER_TRADE_BY_ITEM_ID]
  }
}

export function getOrderAndTradeQueries(filters: OrderFilters & { nftIds?: string[] }): OrderQueries {
  const { orders: ordersFilters, trades: tradesFilters } = getOrdersAndTradesFilters(filters)

  const commonQueryParts = getOrdersSortByStatement(filters).append(getInnerOrdersLimitAndOffsetStatement(filters))

  const orderTradesQuery = SQL`SELECT *, COUNT(*) OVER() as count `
    .append(SQL`FROM (`)
    .append(getTradesOrdersQuery())
    .append(SQL`) as order_trades`)
    .append(getWhereStatementFromFilters(tradesFilters))
    .append(commonQueryParts)

  const legacyOrdersQuery = SQL`SELECT *, COUNT(*) OVER() as count `
    .append(SQL`FROM (`)
    .append(getLegacyOrdersQuery())
    .append(SQL`) as legacy_orders`)
    .append(getWhereStatementFromFilters(ordersFilters))
    .append(commonQueryParts)

  return {
    orderTradesQuery,
    legacyOrdersQuery
  }
}

// The original getOrdersQuery can now use the new function if needed
export function getOrdersQuery(filters: OrderFilters & { nftIds?: string[] }): SQLStatement {
  const { orderTradesQuery, legacyOrdersQuery } = getOrderAndTradeQueries(filters)

  return SQL`
    SELECT *, COUNT(*) OVER() as count FROM (
      (`
    .append(orderTradesQuery)
    .append(
      SQL`)
      UNION ALL
      (`.append(legacyOrdersQuery).append(SQL`)
    ) as combined_orders`)
    )
    .append(getOrdersSortByStatement(filters).append(getOrdersLimitAndOffsetStatement(filters)))
}

export function getOrdersCountQuery(filters: OrderFilters & { nftIds?: string[] }): SQLStatement {
  // const { orderTradesQuery, legacyOrdersQuery } = getOrderAndTradeQueries(filters)
  const { orders: ordersFilters, trades: tradesFilters } = getOrdersAndTradesFilters(filters)

  return SQL`
    WITH aggregated_counts AS (
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
    .append(getTradesOrdersQuery())
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
          FROM   squid_marketplace."order"
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
}
