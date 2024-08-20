import { ILoggerComponent } from '@well-known-components/interfaces'
import { IPgComponent } from '@well-known-components/pg-component'
import { formatEther } from 'ethers'
import {
  ERC20TradeAsset,
  Trade,
  TradeAssetType,
  TradeCreation,
  TradeType,
  Events,
  TradeAsset,
  ERC721TradeAsset,
  CollectionItemTradeAsset,
  ListingStatus
} from '@dcl/schemas'
import { isErrorWithMessage } from '../../logic/errors'
import { getBidsQuery } from '../bids/queries'
import { IEventPublisherComponent } from '../events/types'
import { getItemByItemIdQuery } from '../items/queries'
import { DBItem } from '../items/types'
import { getNftByTokenIdQuery, getNFTsQuery } from '../nfts/queries'
import { DBNFT } from '../nfts/types'
import { DuplicatedBidError, DuplicateNFTOrderError, InvalidTradeStructureError } from './errors'

export function isERC20TradeAsset(asset: TradeAsset): asset is ERC20TradeAsset {
  return asset.assetType === TradeAssetType.ERC20
}

export function isERC721TradeAsset(asset: TradeAsset): asset is ERC721TradeAsset {
  return asset.assetType === TradeAssetType.ERC721
}

export function isCollectionItemTradeAsset(asset: TradeAsset): asset is CollectionItemTradeAsset {
  return asset.assetType === TradeAssetType.COLLECTION_ITEM
}

export async function validateTradeByType(trade: TradeCreation, client: IPgComponent): Promise<boolean> {
  const { sent, received, type } = trade
  try {
    if (type === TradeType.BID) {
      // validate bid structure
      const receivesERC721OrItemAsset =
        received.length === 1 && (isERC721TradeAsset(received[0]) || isCollectionItemTradeAsset(received[0]))
      const sendsERC20Asset = sent.length === 1 && isERC20TradeAsset(sent[0])

      if (!receivesERC721OrItemAsset || !sendsERC20Asset) {
        throw new InvalidTradeStructureError(type)
      }

      const duplicateBid = await client.query(
        getBidsQuery({
          bidder: trade.signer,
          network: trade.network,
          contractAddress: trade.received[0].contractAddress,
          ...('tokenId' in trade.received[0] ? { tokenId: trade.received[0].tokenId } : {}),
          ...('itemId' in trade.received[0] ? { itemId: trade.received[0].itemId } : {}),
          status: ListingStatus.OPEN
        })
      )
      if (duplicateBid.rowCount > 0) {
        throw new DuplicatedBidError()
      }
    }

    if (trade.type === TradeType.PUBLIC_NFT_ORDER) {
      const sendsERC721Asset = sent.length === 1 && isERC721TradeAsset(sent[0])
      const receivesERC20Asset = received.length === 1 && isERC20TradeAsset(received[0])

      if (!sendsERC721Asset || !receivesERC20Asset) {
        throw new InvalidTradeStructureError(trade.type)
      }

      const duplicateOrder = await client.query(
        getNFTsQuery({
          contractAddresses: [trade.sent[0].contractAddress],
          tokenId: (trade.sent[0] as ERC721TradeAsset).tokenId,
          network: trade.network,
          isOnSale: true
        })
      )

      if (duplicateOrder.rowCount > 0) {
        throw new DuplicateNFTOrderError()
      }
    }

    if (trade.type === TradeType.PUBLIC_ITEM_ORDER) {
      const sendsCollectionItemAsset = sent.length === 1 && isCollectionItemTradeAsset(sent[0])
      const receivesERC20Asset = received.length === 1 && isERC20TradeAsset(received[0])

      if (!sendsCollectionItemAsset || !receivesERC20Asset) {
        throw new InvalidTradeStructureError(trade.type)
      }

      // TODO: Add duplicate check for public item orders
    }

    return true
  } catch (e) {
    console.error(e)
    throw e
  }
}

export async function triggerEvent(
  trade: Trade,
  pg: IPgComponent,
  eventPublisher: IEventPublisherComponent,
  logger: ILoggerComponent.ILogger
): Promise<void> {
  const marketplaceBaseUrl = process.env.MARKETPLACE_BASE_URL

  try {
    if (trade.type === TradeType.BID) {
      const bidAsset = trade.received[0]
      let asset: DBNFT | DBItem | null = null
      if (bidAsset.assetType === TradeAssetType.ERC721) {
        asset = await pg
          .query<DBNFT>(getNftByTokenIdQuery(bidAsset.contractAddress, bidAsset.tokenId, trade.network))
          .then(result => result.rows[0])
      } else if (bidAsset.assetType === TradeAssetType.COLLECTION_ITEM) {
        asset = await pg.query<DBItem>(getItemByItemIdQuery(bidAsset.contractAddress, bidAsset.itemId)).then(result => result.rows[0])
      }

      if (!asset) {
        return
      }

      const messageId = await eventPublisher.publishMessage({
        type: Events.Type.MARKETPLACE,
        subType: Events.SubType.Marketplace.BID_RECEIVED,
        key: `bid-created-${trade.id}`,
        timestamp: trade.createdAt,
        metadata: {
          address: 'creator' in asset ? asset.creator : asset.owner,
          image: asset.image,
          seller: 'creator' in asset ? asset.creator : asset.owner,
          category: asset.category,
          rarity: asset.rarity,
          link: `${marketplaceBaseUrl}/account?section=bids`,
          nftName: asset.name,
          price: (trade.sent[0] as ERC20TradeAsset).amount,
          title: 'Bid Received',
          description: `You received a bid of ${formatEther((trade.sent[0] as ERC20TradeAsset).amount)} MANA for this ${asset.name}.`,
          network: trade.network
        }
      })
      logger.info(`Notification has been send for trade ${trade.id} with message id ${messageId}`)
    }
  } catch (e) {
    logger.error('Error triggering notification event', isErrorWithMessage(e) ? e.message : (e as any))
  }
}
