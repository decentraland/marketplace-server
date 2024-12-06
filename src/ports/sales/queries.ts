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
  const FILTER_BY_BUYER = filters.buyer ? SQL` buyer = ${filters.buyer} ` : null
  const FILTER_BY_SELLER = filters.seller ? SQL` seller = ${filters.seller.toLowerCase()} ` : null
  const FILTER_BY_CONTRACT_ADDRESS = filters.contractAddress ? SQL` contract_address = ${filters.contractAddress.toLowerCase()} ` : null
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

function getLegacySalesQuery(filters: SaleFilters): SQLStatement {
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

  const where = getWhereStatementFromFilters([
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
    `
    .append(where)
    .append(getSalesLimitAndOffsetStatement(filters))
  // .append(SQL` LIMIT ${filters.first} OFFSET ${filters.skip} `)
}

function getTradeSalesQuery(filters: SaleFilters): SQLStatement {
  const FILTER_BY_TYPE = filters.type
    ? filters.type == SaleType.ORDER
      ? SQL` trade.type = '`.append(TradeType.PUBLIC_NFT_ORDER).append(SQL`'`)
      : filters.type == SaleType.BID
      ? SQL` c'`.append(TradeType.PUBLIC_NFT_ORDER).append(SQL`'`)
      : SQL` `
    : null

  const FILTER_BY_BUYER = filters.buyer ? SQL` trade_status.sent_beneficiary = ${filters.buyer} ` : null
  const FILTER_BY_SELLER = filters.seller ? SQL` trade_status.received_beneficiary = ${filters.seller.toLowerCase()} ` : null
  const HAVING_BY_CONTRACT_ADDRESS = filters.contractAddress
    ? SQL` (
                array_agg(assets_with_values.contract_address) FILTER (
                    WHERE
                        assets_with_values.asset_type = '3'
                        OR assets_with_values.asset_type = '4'
                )
            ) [1] = ${filters.contractAddress.toLowerCase()} `
    : null
  const HAVING_BY_ITEM_ID = filters.itemId
    ? SQL` (
                array_agg(assets_with_values.item_id) FILTER (
                    WHERE
                        assets_with_values.item_id IS NOT NULL
                )
            ) [1] = ${filters.itemId} `
    : null
  const HAVING_BY_TOKEN_ID = filters.tokenId
    ? SQL` (
                array_agg(assets_with_values.token_id) FILTER (
                    WHERE
                        assets_with_values.token_id IS NOT NULL
                )
            ) [1] = ${filters.tokenId} `
    : null
  const FILTER_BY_NETWORK = filters.network ? SQL` trade_status.network = ANY (${getDBNetworks(filters.network)}) ` : null
  const HAVING_BY_MIN_PRICE = filters.minPrice
    ? SQL` (
                array_agg(assets_with_values.amount) FILTER (
                    WHERE
                        assets_with_values.asset_type = '1'
                )
            ) [1]  >= ${filters.minPrice} `
    : null
  const HAVING_BY_MAX_PRICE = filters.maxPrice
    ? SQL` (
                array_agg(assets_with_values.amount) FILTER (
                    WHERE
                        assets_with_values.asset_type = '1'
                )
            ) [1]  <= ${filters.maxPrice} `
    : null
  const HAVING_BY_CATEGORY =
    filters.categories && filters.categories.length
      ? SQL` (
                array_agg(assets_with_values.category) FILTER (
                    WHERE
                        assets_with_values.category IS NOT NULL
                )
            ) [1] = ANY (${filters.categories}) `
      : null
  const FILTER_FROM_TIMESTAMP = filters.from ? SQL` trade_status.timestamp >= ${filters.from} ` : null
  const FILTER_TO_TIMESTAMP = filters.to ? SQL` trade_status.timestamp <= ${filters.to} ` : null

  const where = getWhereStatementFromFilters([
    SQL`trade_status.action = 'executed' AND trade.type != '`.append(TradeType.PUBLIC_ITEM_ORDER).append(SQL`'`),
    FILTER_BY_TYPE,
    FILTER_BY_BUYER,
    FILTER_BY_SELLER,
    FILTER_BY_NETWORK,
    FILTER_FROM_TIMESTAMP,
    FILTER_TO_TIMESTAMP
  ])

  const having = getWhereStatementFromFilters(
    [HAVING_BY_CONTRACT_ADDRESS, HAVING_BY_ITEM_ID, HAVING_BY_TOKEN_ID, HAVING_BY_MIN_PRICE, HAVING_BY_MAX_PRICE, HAVING_BY_CATEGORY],
    true
  )

  return SQL`
    SELECT
      trade_status.id as id,
      CASE
        WHEN trade.type = '`
    .append(TradeType.PUBLIC_NFT_ORDER)
    .append(SQL`' THEN '`)
    .append(SaleType.ORDER)
    .append(
      SQL`'
        ELSE '`
        .append(SaleType.BID)
        .append(
          SQL`' END as type,
      trade_status.received_beneficiary as seller,
      trade_status.sent_beneficiary as buyer,
      trade_status.timestamp,
      trade_status.network,
      trade_status.tx_hash,
      (array_agg(assets_with_values.amount) FILTER (WHERE assets_with_values.asset_type = '`
            .append(TradeAssetType.ERC20)
            .append(
              SQL`'))[1] as price,
      (array_agg(assets_with_values.item_id) FILTER (WHERE assets_with_values.item_id IS NOT NULL))[1] as item_id,
      (array_agg(assets_with_values.token_id) FILTER (WHERE assets_with_values.token_id IS NOT NULL))[1] as token_id,
      (array_agg(assets_with_values.contract_address) FILTER (WHERE assets_with_values.asset_type = '`
                .append(TradeAssetType.ERC721)
                .append(
                  SQL`' OR assets_with_values.asset_type = '`.append(TradeAssetType.COLLECTION_ITEM).append(
                    SQL`'))[1] as contract_address,
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
          WHEN item.item_type = '`
                      .append(ItemType.WEARABLE_V1)
                      .append(
                        SQL`' THEN '`.append(NFTCategory.WEARABLE).append(
                          SQL`'
          WHEN item.item_type = '`
                            .append(ItemType.WEARABLE_V2)
                            .append(
                              SQL`' THEN '`.append(NFTCategory.WEARABLE).append(
                                SQL`'
          WHEN item.item_type = '`
                                  .append(ItemType.SMART_WEARABLE_V1)
                                  .append(
                                    SQL`' THEN '`.append(NFTCategory.WEARABLE).append(
                                      SQL`'
          WHEN item.item_type = '`
                                        .append(ItemType.EMOTE_V1)
                                        .append(
                                          SQL`' THEN '`.append(NFTCategory.EMOTE).append(
                                            SQL`'
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
    `
                                              .append(where)
                                              .append(
                                                SQL` GROUP BY trade_status.id, trade_status.timestamp, trade_status.network, trade_status.tx_hash, trade_status.sent_beneficiary, trade_status.received_beneficiary, trade.type `
                                              )
                                              .append(having)
                                          )
                                        )
                                    )
                                  )
                              )
                            )
                        )
                      )
                  )
                )
            )
        )
    )
}

export function getSalesQuery(filters: SaleFilters = {}) {
  const LEGACY_SALES = SQL`(`.append(getLegacySalesQuery(filters)).append(SQL` ) as legacy_sales `)
  const TRADE_SALES = SQL`(`.append(getTradeSalesQuery(filters)).append(SQL` ) as trade_sales `)

  return SQL`SELECT *, COUNT(*) OVER() as count`
    .append(SQL` FROM `)
    .append(LEGACY_SALES)
    .append(SQL` NATURAL FULL OUTER JOIN `)
    .append(TRADE_SALES)
    .append(getSalesSortByStatement(filters.sortBy))
    .append(getSalesLimitAndOffsetStatement(filters))
}
