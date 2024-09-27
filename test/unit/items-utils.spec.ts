import { NFTCategory } from '@dcl/schemas'
import { ItemType } from '../../src/ports/items'

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

describe('when getting item type from nft category', () => {
  describe('when category is wearable', () => {
    it('should return correct item types', () => {
      expect(getItemTypesFromNFTCategory(NFTCategory.WEARABLE)).toEqual([
        ItemType.WEARABLE_V1,
        ItemType.WEARABLE_V2,
        ItemType.SMART_WEARABLE_V1
      ])
    })
  })

  describe('when category is emote', () => {
    it('should return correct item types', () => {
      expect(getItemTypesFromNFTCategory(NFTCategory.EMOTE)).toEqual([ItemType.EMOTE_V1])
    })
  })
})
