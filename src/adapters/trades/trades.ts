import { formatEther } from 'ethers'
import {
  ERC20TradeAsset,
  Event,
  Events,
  Network,
  Trade,
  TradeAsset,
  TradeAssetDirection,
  TradeAssetType,
  TradeAssetWithBeneficiary,
  TradeType
} from '@dcl/schemas'
import { DBItem } from '../../ports/items/types'
import { DBNFT } from '../../ports/nfts/types'
import { DBTrade, DBTradeAssetWithValue, TradeEvent } from '../../ports/trades'
import { getCategoryFromDBItem } from '../items'

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

export function fromBidAndAssetsToBidCreatedEventNotification(bid: Trade, assets: (DBNFT | DBItem | undefined)[]): Event | null {
  if (!assets.length) {
    return null
  }

  const asset = assets.find(
    asset =>
      ('tokenId' in bid.received[0] && asset && 'token_id' in asset && asset.token_id === bid.received[0].tokenId) ||
      ('itemId' in bid.received[0] && asset && 'item_id' in asset && asset.item_id === bid.received[0].itemId)
  )

  if (!asset) {
    return null
  }

  const MARKETPLACE_BASE_URL = process.env.MARKETPLACE_BASE_URL

  return {
    type: Events.Type.MARKETPLACE,
    subType: Events.SubType.Marketplace.BID_RECEIVED,
    key: `bid-created-${bid.id}`,
    timestamp: bid.createdAt,
    metadata: {
      address: 'creator' in asset ? asset.creator : asset.owner,
      image: asset.image,
      seller: 'creator' in asset ? asset.creator : asset.owner,
      category: 'category' in asset ? asset.category : getCategoryFromDBItem(asset),
      rarity: asset.rarity,
      link: `${MARKETPLACE_BASE_URL}/account?section=bids`,
      nftName: asset.name,
      price: (bid.sent[0] as ERC20TradeAsset).amount,
      title: 'Bid Received',
      description: `You received a bid of ${formatEther((bid.sent[0] as ERC20TradeAsset).amount)} MANA for this ${asset.name}.`,
      network: bid.network
    }
  }
}

export function fromBidAndAssetsToBidAcceptedEventNotification(bid: Trade, assets: (DBNFT | DBItem | undefined)[]): Event | null {
  if (assets.length !== 1 || !assets[0]) {
    return null
  }

  const asset = assets[0]
  const MARKETPLACE_BASE_URL = process.env.MARKETPLACE_BASE_URL

  const link =
    'token_id' in asset
      ? `${MARKETPLACE_BASE_URL}/contracts/${asset.contract_address}/tokens/${asset.token_id}`
      : `${MARKETPLACE_BASE_URL}/contracts/${asset.contract_address}/items/${asset.item_id}`

  return {
    type: Events.Type.BLOCKCHAIN,
    subType: Events.SubType.Blockchain.BID_ACCEPTED,
    key: `bid-accepted-${bid.id}`,
    timestamp: Date.now(),
    metadata: {
      address: bid.signer,
      image: asset.image,
      seller: 'creator' in asset ? asset.creator : asset.owner,
      category: 'category' in asset ? asset.category : getCategoryFromDBItem(asset),
      rarity: asset.rarity,
      link,
      nftName: asset.name,
      price: (bid.sent[0] as ERC20TradeAsset).amount,
      title: 'Bid Accepted',
      description: `Your bid for ${formatEther((bid.sent[0] as ERC20TradeAsset).amount)} MANA for this ${asset.name} was accepted.`,
      network: bid.network
    }
  }
}

export function fromTradeAndAssetsToEventNotification(
  trade: Trade,
  assets: (DBNFT | DBItem | undefined)[],
  tradeEvent: TradeEvent
): Event | null {
  const tradeMappingFn = {
    [TradeType.BID]: {
      [TradeEvent.CREATED]: fromBidAndAssetsToBidCreatedEventNotification,
      [TradeEvent.ACCEPTED]: fromBidAndAssetsToBidAcceptedEventNotification
    },
    [TradeType.PUBLIC_ITEM_ORDER]: {
      [TradeEvent.CREATED]: null, // TODO: Add event for public item order created
      [TradeEvent.ACCEPTED]: null // TODO: Add event for public item order created
    },
    [TradeType.PUBLIC_NFT_ORDER]: {
      [TradeEvent.CREATED]: null, // TODO: Add event for public nft order created
      [TradeEvent.ACCEPTED]: null // TODO: Add event for public nft order created
    }
  }

  const mappingFn = tradeMappingFn[trade.type] && tradeMappingFn[trade.type][tradeEvent]

  if (mappingFn) {
    return mappingFn(trade, assets)
  }

  return null
}
