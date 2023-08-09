import { Network, Item, NFTCategory, WearableCategory, BodyShape, Rarity, EmoteCategory } from '@dcl/schemas'
import { getPolygonChainId, getEthereumChainId } from '../../logic/chainIds'
import { CollectionsItemDBResult } from './types'

export enum FragmentItemType {
  WEARABLE_V1 = 'wearable_v1',
  WEARABLE_V2 = 'wearable_v2',
  SMART_WEARABLE_V1 = 'smart_wearable_v1',
  EMOTE_V1 = 'emote_v1'
}

// The thumbnail urls indexed are wrong, so we need to fix them by appending the blockchainId to the URN in the middle
function fixThumbnail(thumbnail: string, blockchainId: string) {
  let fixedUrl = thumbnail.replace('polygon', 'matic').replace('mainnet', 'ethereum')

  if (fixedUrl.includes('ethereum')) {
    return fixedUrl
  }

  const urlParts = fixedUrl.split(':')

  // Check if the part to fix is not prefixed with '0x'
  if (!urlParts[5].startsWith('0x')) {
    // Add the '0x' prefix if it's not there
    urlParts[5] = '0x' + urlParts[5]
    urlParts[5] = urlParts[5].replace('/thumbnail', `:${blockchainId}/thumbnail`)
  }

  // Join the parts back together
  fixedUrl = urlParts.join(':')

  return fixedUrl
}

export function fromCollectionsItemDbResultToCatalogItem(dbItem: CollectionsItemDBResult, network?: Network): Item {
  let name: string
  let category: NFTCategory
  let data: Item['data']

  switch (dbItem.item_type) {
    case FragmentItemType.WEARABLE_V1:
    case FragmentItemType.WEARABLE_V2:
    case FragmentItemType.SMART_WEARABLE_V1: {
      const { name: wearableName, body_shapes, description, category: wearableCategory } = dbItem.metadata || {}
      name = wearableName
      category = NFTCategory.WEARABLE
      data = {
        wearable: {
          description,
          category: wearableCategory as WearableCategory,
          bodyShapes: body_shapes as BodyShape[],
          rarity: dbItem.rarity as Rarity,
          isSmart: dbItem.item_type === FragmentItemType.SMART_WEARABLE_V1
        }
      }
      break
    }
    case FragmentItemType.EMOTE_V1: {
      const { name: emoteName, body_shapes, description, loop, category: emoteCategory } = dbItem.metadata || {}
      ;(name = emoteName), (category = NFTCategory.EMOTE)
      data = {
        emote: {
          description,
          category: emoteCategory.toLocaleLowerCase() as EmoteCategory, // toLocaleLowerCase used since they were indexed in uppercase.
          bodyShapes: body_shapes as BodyShape[],
          rarity: dbItem.rarity as Rarity,
          loop: !!loop
        }
      }
      break
    }
    default: {
      throw new Error(`Unknown itemType=${dbItem.item_type}`)
    }
  }

  const itemNetwork = dbItem.network ?? network ?? Network.MATIC
  return {
    id: dbItem.id,
    beneficiary: dbItem.beneficiary,
    itemId: dbItem.blockchain_id,
    name,
    thumbnail: fixThumbnail(dbItem.image, dbItem.blockchain_id),
    url: `/contracts/${dbItem.collection}/items/${dbItem.blockchain_id}`,
    urn: dbItem.urn,
    category,
    contractAddress: dbItem.collection,
    rarity: dbItem.rarity as Rarity,
    available: +dbItem.available,
    isOnSale: dbItem.search_is_store_minter && +dbItem.available > 0,
    creator: dbItem.creator,
    data,
    network: itemNetwork,
    chainId: itemNetwork === Network.ETHEREUM ? getEthereumChainId() : getPolygonChainId(),
    price: dbItem.price,
    createdAt: Number(dbItem.created_at),
    updatedAt: Number(dbItem.updated_at),
    reviewedAt: Number(dbItem.reviewed_at),
    firstListedAt: Number(dbItem.first_listed_at),
    soldAt: Number(dbItem.sold_at),
    // Catalog fields
    minPrice: dbItem.min_price,
    maxListingPrice: dbItem.max_listing_price,
    minListingPrice: dbItem.min_listing_price,
    listings: Number(dbItem.listings_count),
    owners: Number(dbItem.owners_count)
  }
}
