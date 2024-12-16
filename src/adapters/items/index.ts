import { EmoteCategory, Item, NFTCategory, WearableCategory } from '@dcl/schemas'
import { isAddressZero } from '../../logic/address'
import { getNetwork, getNetworkChainId } from '../../logic/chainIds'
import { DBItem, ItemType } from '../../ports/items'
import { fixUrn } from '../../ports/nfts/utils'

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
        bodyShapes: dbItem.wearable_body_shapes || [], // if it's wearable, the field will be defined
        category: dbItem.wearable_category as WearableCategory,
        description: dbItem.description || '',
        rarity: dbItem.rarity,
        isSmart: dbItem.item_type === ItemType.SMART_WEARABLE_V1
      }
    }
  }

  return {
    emote: {
      bodyShapes: dbItem.emote_body_shapes || [], // if it's emote, the field will be defined
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
  const beneficiary = dbItem.trade_beneficiary || dbItem.beneficiary
  return {
    id: dbItem.id,
    name: dbItem.name,
    thumbnail: fixUrn(dbItem.image),
    url: `/contracts/${dbItem.contract_address}/items/${dbItem.item_id}`,
    category: getCategoryFromDBItem(dbItem),
    contractAddress: dbItem.contract_address,
    itemId: dbItem.item_id,
    rarity: dbItem.rarity,
    price: dbItem.trade_id ? dbItem.trade_price : dbItem.price,
    available: dbItem.available,
    isOnSale: !!(dbItem.search_is_store_minter || dbItem.trade_id) && dbItem.available > 0,
    creator: dbItem.creator,
    tradeId: dbItem.trade_id,
    beneficiary: isAddressZero(beneficiary) ? null : beneficiary,
    createdAt: dbItem.created_at,
    updatedAt: dbItem.updated_at,
    reviewedAt: dbItem.reviewed_at,
    soldAt: dbItem.sold_at,
    data: getDataFromDBItem(dbItem),
    network: getNetwork(dbItem.network),
    chainId: getNetworkChainId(dbItem.network),
    urn: fixUrn(dbItem.urn),
    firstListedAt: dbItem.first_listed_at?.getTime(),
    tradeExpiresAt: dbItem.trade_expires_at?.getTime(),
    picks: { count: 0 }, // TODO: check this
    utility: dbItem.utility
  }
}
