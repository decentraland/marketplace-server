import { keccak256, toUtf8Bytes } from 'ethers'
import SQL, { SQLStatement } from 'sql-template-strings'
import { TradeAsset, TradeAssetType, TradeAssetWithBeneficiary, TradeCreation, TradeAssetDirection } from '@dcl/schemas'

export function getTradeAssetsWithValuesQuery(customWhere?: SQLStatement) {
  return SQL`
    SELECT t.*, ta.*, erc721.token_id, erc20.amount, item.item_id
    FROM marketplace.trades as t
    JOIN marketplace.trade_assets as ta ON t.id = ta.trade_id
    LEFT JOIN marketplace.trade_assets_erc721 as erc721 ON ta.id = erc721.asset_id
    LEFT JOIN marketplace.trade_assets_erc20 as erc20 ON ta.id = erc20.asset_id
    LEFT JOIN marketplace.trade_assets_item as item ON ta.id = item.asset_id`.append(customWhere ? SQL` WHERE `.append(customWhere) : SQL``)
}

export function getBidsWithAssetsQuery() {
  return getTradeAssetsWithValuesQuery(SQL`t.type = 'bid'`)
}

export function getDuplicateBidQuery(trade: TradeCreation) {
  // TODO: Check trade not cancelled when status table is added
  const FROM_BIDS = SQL`FROM (`.append(getBidsWithAssetsQuery()).append(SQL`) AS bid_with_assets `)
  const NOT_EXPIRED = SQL`bid_with_assets.expires_at > now()::timestamptz(3)`
  const SAME_SIGNER = SQL`LOWER(bid_with_assets.signer) = LOWER(${trade.signer.toLowerCase()})`
  const SAME_NETWORK = SQL`bid_with_assets.network = ${trade.network}`
  const RECEIVED_ASSET = SQL`bid_with_assets.direction = ${TradeAssetDirection.RECEIVED}`
  const SAME_CONTRACT = SQL`LOWER(bid_with_assets.contract_address) = LOWER(${trade.received[0].contractAddress})`
  const SAME_TOKEN_ID =
    'tokenId' in trade.received[0] ? SQL`bid_with_assets.token_id = ${trade.received[0].tokenId}` : SQL`bid_with_assets.token_id IS NULL`
  const SAME_ITEM_ID =
    'itemId' in trade.received[0] ? SQL`bid_with_assets.item_id = ${trade.received[0].itemId}` : SQL`bid_with_assets.item_id IS NULL`

  return SQL`SELECT *`
    .append(FROM_BIDS)
    .append(SQL` WHERE `)
    .append(NOT_EXPIRED)
    .append(SQL` AND `)
    .append(SAME_SIGNER)
    .append(SQL` AND `)
    .append(SAME_NETWORK)
    .append(SQL` AND `)
    .append(RECEIVED_ASSET)
    .append(SQL` AND `)
    .append(SAME_CONTRACT)
    .append(SQL` AND `)
    .append(SAME_TOKEN_ID)
    .append(SQL` AND `)
    .append(SAME_ITEM_ID)
}

export function getInsertTradeQuery(trade: TradeCreation, signer: string) {
  return SQL`INSERT INTO marketplace.trades (
    chain_id,
    checks,
    effective_since,
    expires_at,
    network,
    signature,
    hashed_signature,
    signer,
    type
  ) VALUES (
   ${trade.chainId},
   ${trade.checks},
   ${new Date(trade.checks.effective)},
   ${new Date(trade.checks.expiration)},
   ${trade.network},
   ${trade.signature},
   ${keccak256(toUtf8Bytes(trade.signature))},
   ${signer.toLowerCase()},
   ${trade.type}
   ) RETURNING *;`
}

export function getInsertTradeAssetQuery(asset: TradeAsset | TradeAssetWithBeneficiary, tradeId: string, direction: string) {
  return SQL`INSERT INTO marketplace.trade_assets (
    asset_type,
    beneficiary,
    contract_address,
    direction,
    extra,
    trade_id
    ) VALUES (
      ${asset.assetType},
      ${'beneficiary' in asset ? asset.beneficiary.toLowerCase() : null},
      ${asset.contractAddress.toLowerCase()},
      ${direction},
      ${asset.extra},
      ${tradeId}
    ) RETURNING *;`
}

export function getInsertTradeAssetValueByTypeQuery(asset: TradeAsset | TradeAssetWithBeneficiary, assetId: string) {
  switch (asset.assetType) {
    case TradeAssetType.ERC721:
      return SQL`INSERT INTO marketplace.trade_assets_erc721 (
        asset_id,
        token_id
        ) VALUES (
          ${assetId},
          ${asset.tokenId}
        ) RETURNING *;`
    case TradeAssetType.ERC20:
      return SQL`INSERT INTO marketplace.trade_assets_erc20 (
        asset_id,
        amount
        ) VALUES (
          ${assetId},
          ${asset.amount}
        ) RETURNING *;`
    case TradeAssetType.COLLECTION_ITEM:
      return SQL`INSERT INTO marketplace.trade_assets_item (
        asset_id,
        item_id
        ) VALUES (
          ${assetId},
          ${asset.itemId}
        ) RETURNING *;`
    default:
      throw new Error('Invalid asset type')
  }
}

export function getTradeAssetsWithValuesByIdQuery(id: string) {
  return getTradeAssetsWithValuesQuery(SQL`t.id = ${id}`)
}
