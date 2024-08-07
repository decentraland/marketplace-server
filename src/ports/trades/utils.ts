import { ILoggerComponent } from '@well-known-components/interfaces'
import { IPgComponent } from '@well-known-components/pg-component'
import { formatEther } from 'ethers'
import { ERC20TradeAsset, Trade, TradeAssetType, TradeCreation, TradeType, Events } from '@dcl/schemas'
import { isErrorWithMessage } from '../../logic/errors'
import { IEventPublisherComponent } from '../events/types'
import { getItemByItemIdQuery } from '../items/queries'
import { DBItem } from '../items/types'
import { getNftByTokenIdQuery } from '../nfts/queries'
import { DBNFT } from '../nfts/types'
import { DuplicatedBidError, InvalidTradeStructureError } from './errors'
import { getDuplicateBidQuery } from './queries'

export async function validateTradeByType(trade: TradeCreation, client: IPgComponent): Promise<boolean> {
  const pgClient = await client.getPool().connect()
  try {
    if (trade.type === 'bid') {
      // validate bid structure
      if (
        trade.sent.length !== 1 ||
        trade.sent[0].assetType !== TradeAssetType.ERC20 ||
        trade.received.length !== 1 ||
        ![TradeAssetType.ERC721, TradeAssetType.COLLECTION_ITEM].includes(trade.received[0].assetType)
      ) {
        throw new InvalidTradeStructureError(trade.type)
      }

      const duplicateBid = await client.query(getDuplicateBidQuery(trade))
      if (duplicateBid.rowCount > 0) {
        throw new DuplicatedBidError()
      }
    }

    return true
  } catch (e) {
    console.error(e)
    throw e
  } finally {
    await pgClient.release()
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
