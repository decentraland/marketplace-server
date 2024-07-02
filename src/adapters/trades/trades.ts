import { Network, Trade, TradeAsset, TradeChecks } from '@dcl/schemas'
import { TradeAssetType, TradeAssetWithBeneficiary, TradeType } from '@dcl/schemas/dist/dapps/trade'
import { DBTrade, DBTradeAssetWithValue } from '../../ports/trades'

export function getValueFromDBTradeAssetWithValue(dbTradeAssetWithValue: DBTradeAssetWithValue): string {
  switch (dbTradeAssetWithValue.asset_type) {
    case TradeAssetType.ERC20:
      return dbTradeAssetWithValue.amount.toString()
    case TradeAssetType.ERC721:
      return dbTradeAssetWithValue.token_id
    case TradeAssetType.COLLECTION_ITEM:
      return dbTradeAssetWithValue.item_id
    default:
      throw new Error('Unknown asset type')
  }
}

export function fromDBTradeAssetToTradeAsset(dbTradeAsset: DBTradeAssetWithValue): TradeAsset {
  return {
    assetType: dbTradeAsset.asset_type,
    contractAddress: dbTradeAsset.contract_address,
    value: getValueFromDBTradeAssetWithValue(dbTradeAsset),
    extra: dbTradeAsset.extra
  }
}

export function fromDBTradeAssetToTradeAssetWithBeneficiary(dbTradeAsset: DBTradeAssetWithValue): TradeAssetWithBeneficiary {
  if (!dbTradeAsset.beneficiary) {
    throw new Error('DBTradeAsset does not have a beneficiary')
  }

  return {
    ...fromDBTradeAssetToTradeAsset(dbTradeAsset),
    beneficiary: dbTradeAsset.beneficiary
  }
}

export function fromDbTradeWithAssetsToTrade(dbTrade: DBTrade, assets: DBTradeAssetWithValue[]): Trade {
  return {
    id: dbTrade.id,
    signer: dbTrade.signer,
    type: dbTrade.type as TradeType,
    network: dbTrade.network as Network,
    chainId: dbTrade.chain_id,
    checks: dbTrade.checks as TradeChecks,
    createdAt: dbTrade.created_at.getTime(),
    sent: assets.filter(asset => asset.direction === 'sent').map(fromDBTradeAssetToTradeAsset),
    received: assets.filter(asset => asset.direction === 'received').map(fromDBTradeAssetToTradeAssetWithBeneficiary)
  }
}
