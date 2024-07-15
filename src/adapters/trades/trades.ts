import { Network, Trade, TradeAsset, TradeAssetDirection, TradeAssetType, TradeAssetWithBeneficiary } from '@dcl/schemas'
import { DBTrade, DBTradeAssetWithValue } from '../../ports/trades'

export function fromDBTradeAssetWithValueToTradeAsset(dbTradeAsset: DBTradeAssetWithValue): TradeAsset {
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

export function fromDBTradeAssetWithValueToTradeAssetWithBeneficiary(dbTradeAsset: DBTradeAssetWithValue): TradeAssetWithBeneficiary {
  if (!dbTradeAsset.beneficiary) {
    throw new Error('DBTradeAsset does not have a beneficiary')
  }

  return {
    ...fromDBTradeAssetWithValueToTradeAsset(dbTradeAsset),
    beneficiary: dbTradeAsset.beneficiary
  }
}

export function fromDbTradeAndDBTradeAssetWithValueListToTrade(dbTrade: DBTrade, assets: DBTradeAssetWithValue[]): Trade {
  return {
    id: dbTrade.id,
    signer: dbTrade.signer,
    signature: dbTrade.signature,
    type: dbTrade.type,
    network: dbTrade.network as Network,
    chainId: dbTrade.chain_id,
    checks: dbTrade.checks,
    createdAt: dbTrade.created_at.getTime(),
    sent: assets.filter(asset => asset.direction === TradeAssetDirection.SENT).map(fromDBTradeAssetWithValueToTradeAsset),
    received: assets
      .filter(asset => asset.direction === TradeAssetDirection.RECEIVED)
      .map(fromDBTradeAssetWithValueToTradeAssetWithBeneficiary)
  }
}
