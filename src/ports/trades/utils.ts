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
  ListingStatus,
  Event
} from '@dcl/schemas'
import { fromTradeAndAssetsToEventNotification } from '../../adapters/trades/trades'
import { getBidsQuery } from '../bids/queries'
import { getItemByItemIdQuery, getItemsQuery } from '../items/queries'
import { DBItem } from '../items/types'
import { getNftByTokenIdQuery, getNFTsQuery } from '../nfts/queries'
import { DBNFT } from '../nfts/types'
import { DuplicatedBidError, DuplicateItemOrderError, DuplicateNFTOrderError, InvalidTradeStructureError } from './errors'
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

      console.log('trade.sent[0].contractAddress: ', trade.sent[0].contractAddress)
      console.log('(trade.sent[0] as ERC721TradeAsset).tokenId: ', (trade.sent[0] as ERC721TradeAsset).tokenId)
      const query = getNFTsQuery({
        contractAddresses: [trade.sent[0].contractAddress],
        tokenId: (trade.sent[0] as ERC721TradeAsset).tokenId,
        network: trade.network,
        isOnSale: true
      })
      console.log('query: ', query.text);
      console.log('values: ', query.values);
      const duplicateOrder = await client.query(query)

      console.log('duplicateOrder: ', duplicateOrder)
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

      const duplicateOrder = await client.query(
        getItemsQuery({
          contractAddresses: [trade.sent[0].contractAddress],
          itemId: (trade.sent[0] as CollectionItemTradeAsset).itemId,
          network: trade.network,
          isOnSale: true
        })
      )

      if (duplicateOrder.rowCount > 0) {
        throw new DuplicateItemOrderError()
      }
    }

    return true
  } catch (e) {
    console.error(e)
    throw e
  }
}

export async function getNotificationEventForTrade(
  trade: Trade,
  pg: IPgComponent,
  tradeEvent: TradeEvent,
  caller: string
): Promise<Event | null> {
  const assets: (DBNFT | DBItem | undefined)[] = await Promise.all(
    [...trade.sent, ...trade.received].map((asset: TradeAsset) => {
      if (asset.assetType === TradeAssetType.ERC721) {
        return pg.query<DBNFT>(getNftByTokenIdQuery(asset.contractAddress, asset.tokenId, trade.network)).then(result => result.rows[0])
      } else if (asset.assetType === TradeAssetType.COLLECTION_ITEM) {
        return pg.query<DBItem>(getItemByItemIdQuery(asset.contractAddress, asset.itemId)).then(result => result.rows[0])
      } else {
        return Promise.resolve(undefined)
      }
    })
  )

  return fromTradeAndAssetsToEventNotification(trade, assets, tradeEvent, caller)
}
