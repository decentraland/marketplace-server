import { Network, Trade, TradeAsset, TradeChecks } from '@dcl/schemas'
import { TradeAssetWithBeneficiary, TradeType } from '@dcl/schemas/dist/dapps/trade'
import { DBTrade, DBTradeAsset } from '../../ports/trades'

export function fromDBTradeAssetToTradeAsset(dbTradeAsset: DBTradeAsset): TradeAsset {
  return {
    assetType: dbTradeAsset.asset_type,
    contractAddress: dbTradeAsset.contract_address,
    value: dbTradeAsset.value,
    extra: dbTradeAsset.extra
  }
}

export function fromDBTradeAssetToTradeAssetWithBeneficiary(dbTradeAsset: DBTradeAsset): TradeAssetWithBeneficiary {
  if (!dbTradeAsset.beneficiary) {
    throw new Error('DBTradeAsset does not have a beneficiary')
  }

  return {
    ...fromDBTradeAssetToTradeAsset(dbTradeAsset),
    beneficiary: dbTradeAsset.beneficiary
  }
}

export function fromDbTradeWithAssetsToTrade(dbTrade: DBTrade, sentAssets: DBTradeAsset[], receivedAssets: DBTradeAsset[]): Trade {
  return {
    id: dbTrade.id,
    signer: dbTrade.signer,
    type: dbTrade.type as TradeType,
    network: dbTrade.network as Network,
    chainId: dbTrade.chain_id,
    checks: dbTrade.checks as TradeChecks,
    createdAt: dbTrade.created_at.getTime(),
    sent: sentAssets.map(fromDBTradeAssetToTradeAsset),
    received: receivedAssets.map(fromDBTradeAssetToTradeAssetWithBeneficiary)
  }
}
