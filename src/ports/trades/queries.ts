import SQL from 'sql-template-strings'
import { TradeAsset } from '@dcl/schemas'
import { TradeAssetType, TradeAssetWithBeneficiary, TradeCreation } from '@dcl/schemas/dist/dapps/trade'

export function getDuplicateBidQuery(trade: TradeCreation) {
  // TODO: Check trade not cancelled when status table is added
  return SQL`
    SELECT *
    FROM marketplace.trades as trades, marketplace.trade_assets as trade_assets, marketplace.trade_assets_erc721 as trade_assets_erc721
    WHERE trades.id = trade_assets.trade_id
      AND trade_assets.id = trade_assets_erc721.asset_id
      AND trades.type = 'bid'
      AND LOWER(trades.signer) = LOWER(${trade.signer.toLowerCase()})
      AND trades.network = ${trade.network}
      AND trades.expires_at > now()
      AND trade_assets.direction = 'received'
      AND LOWER(trade_assets.contract_address) = LOWER(${trade.received[0].contractAddress})
      AND trade_assets_erc721.token_id = ${trade.received[0].value}
      AND trade_assets.asset_type = ${trade.received[0].assetType};`
}

export function getInsertTradeQuery(trade: TradeCreation, signer: string) {
  return SQL`INSERT INTO marketplace.trades (
    chain_id,
    checks,
    effective_since,
    expires_at,
    network,
    signature,
    signer,
    type
  ) VALUES (
   ${trade.chainId},
   ${trade.checks},
   ${new Date(trade.checks.effective)},
   ${new Date(trade.checks.expiration)},
   ${trade.network},
   ${trade.signature},
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
          ${asset.value}
        ) RETURNING *;`
    case TradeAssetType.ERC20:
      return SQL`INSERT INTO marketplace.trade_assets_erc20 (
        asset_id,
        amount
        ) VALUES (
          ${assetId},
          ${Number.parseInt(asset.value)}
        ) RETURNING *;`
    case TradeAssetType.COLLECTION_ITEM:
      return SQL`INSERT INTO marketplace.trade_assets_erc20 (
        asset_id,
        item_id
        ) VALUES (
          ${assetId},
          ${Number.parseInt(asset.value)}
        ) RETURNING *;`
    default:
      throw new Error(`Invalid asset type ${asset.assetType}`)
  }
}
