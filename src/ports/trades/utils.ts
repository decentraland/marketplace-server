import { IPgComponent } from '@well-known-components/pg-component'
import {
  ERC20TradeAsset,
  Trade,
  TradeAssetType,
  TradeCreation,
  TradeType,
  TradeAsset,
  ERC721TradeAsset,
  CollectionItemTradeAsset,
  Event
} from '@dcl/schemas'
import { fromTradeAndAssetsToEventNotification } from '../../adapters/trades/trades'
import { getItemByItemIdQuery } from '../items/queries'
import { DBItem } from '../items/types'
import { getNftByTokenIdQuery } from '../nfts/queries'
import { DBNFT } from '../nfts/types'
import { DuplicatedBidError, InvalidTradeStructureError } from './errors'
import { getDuplicateBidQuery } from './queries'
import { TradeEvent } from './types'

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

      const duplicateBid = await client.query(getDuplicateBidQuery(trade))
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

      // TODO: Add duplicate check for public nft orders
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
