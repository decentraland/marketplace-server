import { IPgComponent } from '@well-known-components/pg-component'
import { Trade, TradeAssetType, TradeCreation, Event, TradeAsset, CollectionItemTradeAsset } from '@dcl/schemas'
import { fromTradeAndAssetsToEventNotification } from '../../adapters/trades/trades'
import { getItemByItemIdQuery } from '../items/queries'
import { DBItem } from '../items/types'
import { getNftByTokenIdQuery } from '../nfts/queries'
import { DBNFT } from '../nfts/types'
import { DuplicatedBidError, InvalidTradeStructureError } from './errors'
import { getDuplicateBidQuery } from './queries'
import { TradeEvent } from './types'

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

export async function getNotificationEventForTrade(trade: Trade, pg: IPgComponent, tradeEvent: TradeEvent): Promise<Event | null> {
  const assets: (DBNFT | DBItem | undefined)[] = await Promise.all(
    [...trade.sent, ...trade.received]
      .filter(asset => [TradeAssetType.ERC721, TradeAssetType.COLLECTION_ITEM].includes(asset.assetType))
      .map((asset: TradeAsset) => {
        if (asset.assetType === TradeAssetType.ERC721) {
          return pg.query<DBNFT>(getNftByTokenIdQuery(asset.contractAddress, asset.tokenId, trade.network)).then(result => result.rows[0])
        } else {
          return pg
            .query<DBItem>(getItemByItemIdQuery(asset.contractAddress, (asset as CollectionItemTradeAsset).itemId))
            .then(result => result.rows[0])
        }
      })
  )

  return fromTradeAndAssetsToEventNotification(trade, assets, tradeEvent)
}
