import { NFTCategory } from '@dcl/schemas'
import { ItemType } from './types'

export function getItemTypesFromNFTCategory(category: NFTCategory) {
  switch (category) {
    case NFTCategory.WEARABLE:
      return [ItemType.WEARABLE_V1, ItemType.WEARABLE_V2, ItemType.SMART_WEARABLE_V1]
    case NFTCategory.EMOTE:
      return [ItemType.EMOTE_V1]
    default:
      return []
  }
}
