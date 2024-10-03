import { EmoteCategory, Item, NFTCategory, WearableCategory } from '@dcl/schemas'
import { getNetwork, getNetworkChainId } from '../../logic/chainIds'
import { DBItem, ItemType } from '../../ports/items'

export function getCategoryFromDBItem(dbItem: DBItem): NFTCategory {
  if (
    dbItem.item_type === ItemType.WEARABLE_V1 ||
    dbItem.item_type === ItemType.WEARABLE_V2 ||
    dbItem.item_type === ItemType.SMART_WEARABLE_V1
  ) {
    return NFTCategory.WEARABLE
  }
  return NFTCategory.EMOTE
}

export function getDataFromDBItem(dbItem: DBItem): Item['data'] {
  if (
    dbItem.item_type === ItemType.WEARABLE_V1 ||
    dbItem.item_type === ItemType.WEARABLE_V2 ||
    dbItem.item_type === ItemType.SMART_WEARABLE_V1
  ) {
    return {
      wearable: {
        bodyShapes: dbItem.body_shapes,
        category: dbItem.wearable_category as WearableCategory,
        description: dbItem.description || '',
        rarity: dbItem.rarity,
        isSmart: dbItem.item_type === ItemType.SMART_WEARABLE_V1
      }
    }
  }

  return {
    emote: {
      bodyShapes: dbItem.body_shapes,
      category: dbItem.emote_category as EmoteCategory,
      description: dbItem.description || '',
      rarity: dbItem.rarity,
      loop: dbItem.loop || false,
      hasSound: dbItem.has_sound || false,
      hasGeometry: dbItem.has_geometry || false
    }
  }
}

export function fromDBItemToItem(dbItem: DBItem): Item {
  return {
    id: dbItem.id,
    name: dbItem.name,
    thumbnail: dbItem.image,
    url: dbItem.uri,
    category: getCategoryFromDBItem(dbItem),
    contractAddress: dbItem.contract_address,
    itemId: dbItem.item_id,
    rarity: dbItem.rarity,
    price: dbItem.price,
    available: dbItem.available,
    isOnSale: !!(dbItem.search_is_store_item || dbItem.trade_id) && dbItem.available > 0,
    creator: dbItem.creator,
    tradeId: dbItem.trade_id,
    beneficiary: dbItem.beneficiary,
    createdAt: dbItem.created_at,
    updatedAt: dbItem.updated_at,
    reviewedAt: dbItem.reviewed_at,
    soldAt: dbItem.sold_at,
    data: getDataFromDBItem(dbItem),
    network: getNetwork(dbItem.network),
    chainId: getNetworkChainId(dbItem.network),
    urn: dbItem.urn,
    firstListedAt: dbItem.first_listed_at?.getTime(),
    picks: { count: 0 }, // TODO: check this
    minPrice: '0', // TODO: check this
    minListingPrice: '0', // TODO: check this
    maxListingPrice: '0', // TODO: check this
    listings: 0, // TODO: check this
    owners: 0, // TODO: check this
    utility: '' // TODO: check this
  }
}
