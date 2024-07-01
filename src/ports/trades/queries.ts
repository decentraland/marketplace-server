import SQL from 'sql-template-strings'
import { TradeAsset } from '@dcl/schemas'
import { TradeAssetWithBeneficiary, TradeCreation } from '@dcl/schemas/dist/dapps/trade'

export function getDuplicateBidQuery(trade: TradeCreation) {
  // TODO: Check trade not cancelled when status table is added
  return SQL`
    SELECT *
    FROM marketplace.trades as trades INNER JOIN marketplace.trade_assets as trade_assets ON trades.id = trade_assets.trade_id
    WHERE trades.type = 'bid'
      AND LOWER(trades.signer) = LOWER(${trade.signer.toLowerCase()})
      AND trades.network = ${trade.network}
      AND trades.expires_at > now()
      AND trade_assets.direction = 'received'
      AND LOWER(trade_assets.contract_address) = LOWER(${trade.received[0].contractAddress})
      AND trade_assets.value = ${trade.received[0].value}
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

export function getInsertTradeAssetQuery(asset: TradeAsset, tradeId: string) {
  return SQL`INSERT INTO marketplace.trade_assets (
    asset_type,
    contract_address,
    direction,
    extra,
    trade_id,
    value
    ) VALUES (
      ${asset.assetType},
      ${asset.contractAddress.toLowerCase()},
      'sent',
      ${asset.extra},
      ${tradeId},
      ${asset.value}
    ) RETURNING *;`
}

export function getInsertTradeAssetWithBeneficiaryQuery(asset: TradeAssetWithBeneficiary, tradeId: string) {
  return SQL`INSERT INTO marketplace.trade_assets (
    asset_type,
    beneficiary,
    contract_address,
    direction,
    extra,
    trade_id,
    value
    ) VALUES (
      ${asset.assetType},
      ${asset.beneficiary.toLowerCase()},
      ${asset.contractAddress.toLowerCase()},
      'received',
      ${asset.extra},
      ${tradeId},
      ${asset.value}
    ) RETURNING *;`
}
