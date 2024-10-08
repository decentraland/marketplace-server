import SQL, { SQLStatement } from 'sql-template-strings'
import { OrderFilters, OrderSortBy, TradeType } from '@dcl/schemas'
import { ContractName, getContract } from 'decentraland-transactions'
import { getEthereumChainId, getPolygonChainId } from '../../logic/chainIds'
import { getDBNetworks } from '../../utils'
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

export function getTradesOrdersQuery(): string {
  const marketplacePolygon = getContract(ContractName.OffChainMarketplace, getPolygonChainId())
  const marketplaceEthereum = getContract(ContractName.OffChainMarketplace, getEthereumChainId())
  // Important! This is handled as a string. If input values are later used in this query,
  // they should be sanitized, or the query should be rewritten as an SQLStatement
  return `
    SELECT
      id::text,
      id as trade_id,
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
      ord.marketplace_address,
      ord.category,
      ord.nft_address,
      ord.token_id,
      ord.tx_hash,
      ord.owner,
      ord.buyer,
      ord.price,
      ord.status,
      ord.block_number,
      ord.created_at,
      ord.updated_at,
      ord.expires_at,
      ord.nft_id,
      ord.network,
      ord.item_id,
      nft.issued_id,
      nft.name as nft_name
    FROM squid_marketplace."order" ord
    JOIN squid_marketplace."nft" nft ON ord.nft_id = nft.id`
}

export function getOrdersQuery(filters: OrderFilters & { nftIds?: string[] }): SQLStatement {
  const ORDER_TRADES = ` (${getTradesOrdersQuery()}) as order_trades `
  const LEGACY_ORDERS = ` (${getLegacyOrdersQuery()}) as legacy_orders`

  const FILTER_BY_MARKETPLACE_ADDRESS = filters.marketplaceAddress
    ? SQL` LOWER(marketplace_address) = LOWER(${filters.marketplaceAddress}) `
    : null
  const FILTER_BY_OWNER = filters.owner ? SQL` LOWER(owner) = LOWER(${filters.owner}) ` : null
  const FILTER_BY_BUYER = filters.buyer ? SQL` LOWER(buyer) = LOWER(${filters.buyer}) ` : null
  const FILTER_BY_CONTRACT_ADDRESS = filters.contractAddress ? SQL` LOWER(nft_address) = LOWER(${filters.contractAddress}) ` : null
  const FILTER_BY_TOKEN_ID = filters.tokenId ? SQL` token_id = ${filters.tokenId} ` : null
  const FILTER_BY_STATUS = filters.status ? SQL` status = ${filters.status} ` : null
  const FILTER_BY_NETWORK = filters.network ? SQL` network = ANY(${getDBNetworks(filters.network)}) ` : null
  const FILTER_BY_ITEM_ID = filters.itemId ? SQL` item_id = ${filters.itemId} ` : null
  const FILTER_BY_NFT_NAME = filters.nftName ? SQL` LOWER(nft_name) = LOWER(${filters.nftName}) ` : null
  const FILTER_BY_NFT_ID = filters.nftIds ? SQL` nft_id = ANY(${filters.nftIds}) ` : null
  const FILTER_NOT_EXPIRED = SQL` expires_at > EXTRACT(EPOCH FROM now()::timestamptz(3)) `

  const FILTERS = getWhereStatementFromFilters([
    FILTER_BY_MARKETPLACE_ADDRESS,
    FILTER_BY_OWNER,
    FILTER_BY_BUYER,
    FILTER_BY_CONTRACT_ADDRESS,
    FILTER_BY_TOKEN_ID,
    FILTER_BY_STATUS,
    FILTER_BY_NETWORK,
    FILTER_BY_ITEM_ID,
    FILTER_BY_NFT_NAME,
    FILTER_BY_NFT_ID,
    FILTER_NOT_EXPIRED
  ])

  return SQL`SELECT *, COUNT(*) OVER() as count`
    .append(SQL` FROM `)
    .append(ORDER_TRADES)
    .append(SQL` NATURAL FULL OUTER JOIN `)
    .append(LEGACY_ORDERS)
    .append(FILTERS)
    .append(getOrdersSortByStatement(filters))
    .append(getOrdersLimitAndOffsetStatement(filters))
}
