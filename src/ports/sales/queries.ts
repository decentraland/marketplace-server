import SQL, { SQLStatement } from 'sql-template-strings'
import { NFTCategory, SaleFilters, SaleSortBy, SaleType, TradeAssetType, TradeType } from '@dcl/schemas'
import { getDBNetworks } from '../../utils'
import { ItemType } from '../items'
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

function getSalesWhereStatement(filters: SaleFilters): SQLStatement {
  if (!filters) {
    return SQL``
  }

  const FILTER_BY_TYPE = filters.type ? SQL` type = ${filters.type} ` : null
  const FILTER_BY_BUYER = filters.buyer ? SQL` LOWER(buyer) = LOWER(${filters.buyer}) ` : null
  const FILTER_BY_SELLER = filters.seller ? SQL` LOWER(seller) = LOWER(${filters.seller}) ` : null
  const FILTER_BY_CONTRACT_ADDRESS = filters.contractAddress ? SQL` LOWER(contract_address) = LOWER(${filters.contractAddress}) ` : null
  const FILTER_BY_ITEM_ID = filters.itemId ? SQL` item_id = ${filters.itemId} ` : null
  const FILTER_BY_TOKEN_ID = filters.tokenId ? SQL` token_id = ${filters.tokenId} ` : null
  const FILTER_BY_NETWORK = filters.network ? SQL` network = ANY (${getDBNetworks(filters.network)}) ` : null
  const FILTER_BY_MIN_PRICE = filters.minPrice ? SQL` price >= ${filters.minPrice} ` : null
  const FILTER_BY_MAX_PRICE = filters.maxPrice ? SQL` price <= ${filters.maxPrice} ` : null
  const FILTER_BY_CATEGORY = filters.categories && filters.categories.length ? SQL` category = ANY (${filters.categories}) ` : null
  const FILTER_FROM_TIMESTAMP = filters.from ? SQL` timestamp >= ${filters.from} ` : null
  const FILTER_TO_TIMESTAMP = filters.to ? SQL` timestamp <= ${filters.to} ` : null

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

function getLegacySalesQuery(): string {
  return `
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
  `
}

function getTradeSalesQuery(): string {
  return `
    SELECT
      trade_status.id as id,
      CASE
        WHEN trade.type = '${TradeType.PUBLIC_NFT_ORDER}' THEN '${SaleType.ORDER}'
        ELSE '${SaleType.BID}' END as type,
      trade_status.received_beneficiary as seller,
      trade_status.sent_beneficiary as buyer,
      trade_status.timestamp,
      trade_status.network,
      trade_status.tx_hash,
      (array_agg(assets_with_values.amount) FILTER (WHERE assets_with_values.asset_type = '${TradeAssetType.ERC20}'))[1] as price,
      (array_agg(assets_with_values.item_id) FILTER (WHERE assets_with_values.item_id IS NOT NULL))[1] as item_id,
      (array_agg(assets_with_values.token_id) FILTER (WHERE assets_with_values.token_id IS NOT NULL))[1] as token_id,
      (array_agg(assets_with_values.contract_address) FILTER (WHERE assets_with_values.asset_type = '${TradeAssetType.ERC721}' OR assets_with_values.asset_type = '${TradeAssetType.COLLECTION_ITEM}'))[1] as contract_address,
      (array_agg(assets_with_values.category) FILTER (WHERE assets_with_values.category IS NOT NULL))[1] as category
    FROM squid_trades.trade as trade_status
    JOIN marketplace.trades as trade ON trade_status.signature = trade.hashed_signature
    JOIN (
      SELECT
        ta.trade_id,
        ta.contract_address,
        ta.direction,
        ta.beneficiary,
        ta.asset_type,
        ta.extra,
        erc721_asset.token_id,
        coalesce(item_asset.item_id, nft.item_blockchain_id::text) as item_id,
        erc20_asset.amount,
        item.creator,
		    item.item_type,
        account.address as owner,
        CASE
          WHEN item.item_type = '${ItemType.WEARABLE_V1}' THEN '${NFTCategory.WEARABLE}'
          WHEN item.item_type = '${ItemType.WEARABLE_V2}' THEN '${NFTCategory.WEARABLE}'
          WHEN item.item_type = '${ItemType.SMART_WEARABLE_V1}' THEN '${NFTCategory.WEARABLE}'
          WHEN item.item_type = '${ItemType.EMOTE_V1}' THEN '${NFTCategory.EMOTE}'
          ELSE nft.category
        END as category,
          nft.id as nft_id,
          nft.issued_id as issued_id,
          nft.name as nft_name
      FROM marketplace.trade_assets as ta 
      LEFT JOIN marketplace.trade_assets_erc721 as erc721_asset ON ta.id = erc721_asset.asset_id
      LEFT JOIN marketplace.trade_assets_erc20 as erc20_asset ON ta.id = erc20_asset.asset_id
      LEFT JOIN marketplace.trade_assets_item as item_asset ON ta.id = item_asset.asset_id
      LEFT JOIN squid_marketplace.item as item ON (ta.contract_address = item.collection_id AND item_asset.item_id = item.blockchain_id::text)
      LEFT JOIN squid_marketplace.nft as nft ON (ta.contract_address = nft.contract_address AND erc721_asset.token_id = nft.token_id::text)
      LEFT JOIN squid_marketplace.account as account ON (account.id = nft.owner_id)
    ) as assets_with_values ON trade.id = assets_with_values.trade_id    
    WHERE trade_status.action = 'executed' AND trade.type != '${TradeType.PUBLIC_ITEM_ORDER}'
    GROUP BY trade_status.id, trade_status.timestamp, trade_status.network, trade_status.tx_hash, trade_status.sent_beneficiary, trade_status.received_beneficiary, trade.type

  `
}

export function getSalesQuery(filters: SaleFilters = {}) {
  const LEGACY_SALES = ` (${getLegacySalesQuery()}) as legacy_sales `
  const TRADE_SALES = ` (${getTradeSalesQuery()}) as trade_sales `

  return SQL`SELECT *, COUNT(*) OVER() as count`
    .append(SQL` FROM `)
    .append(LEGACY_SALES)
    .append(SQL` NATURAL FULL OUTER JOIN `)
    .append(TRADE_SALES)
    .append(getSalesWhereStatement(filters))
    .append(getSalesSortByStatement(filters.sortBy))
    .append(getSalesLimitAndOffsetStatement(filters))
}
