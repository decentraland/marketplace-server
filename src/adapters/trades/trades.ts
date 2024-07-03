import { Network, Trade, TradeAsset, TradeChecks } from '@dcl/schemas'
import { TradeAssetType, TradeAssetWithBeneficiary, TradeType } from '@dcl/schemas/dist/dapps/trade'
import { DBTrade, DBTradeAssetWithValue } from '../../ports/trades'

export function fromDBTradeAssetToTradeAsset(dbTradeAsset: DBTradeAssetWithValue): TradeAsset {
  const tradeBaseValues = {
    contractAddress: dbTradeAsset.contract_address,
    extra: dbTradeAsset.extra
  }

  switch (dbTradeAsset.asset_type) {
    case TradeAssetType.ERC20:
      return { ...tradeBaseValues, assetType: TradeAssetType.ERC20, amount: dbTradeAsset.amount }
    case TradeAssetType.ERC721:
      return { ...tradeBaseValues, assetType: TradeAssetType.ERC721, tokenId: dbTradeAsset.token_id }
    case TradeAssetType.COLLECTION_ITEM:
      return { ...tradeBaseValues, assetType: TradeAssetType.COLLECTION_ITEM, itemId: dbTradeAsset.item_id }
    default:
      throw new Error('Unknown asset type')
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
