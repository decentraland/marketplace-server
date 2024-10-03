import { BodyShape, EmoteCategory, Network, NFTCategory, Rarity, WearableCategory } from '@dcl/schemas'
import { fromDBItemToItem, getCategoryFromDBItem, getDataFromDBItem } from '../../src/adapters/items'
import { getNetworkChainId, getNetwork } from '../../src/logic/chainIds'
import { DBItem, ItemType } from '../../src/ports/items'

let dbItem: DBItem

beforeEach(() => {
  dbItem = {
    count: 1,
    id: '1',
    available: 0,
    beneficiary: '0x',
    contract_address: '0x1',
    created_at: Date.now(),
    creator: '0x',
    first_listed_at: new Date(),
    image: 'url.png',
    item_id: '1',
    name: 'my name',
    network: Network.ETHEREUM,
    price: '0',
    reviewed_at: Date.now(),
    sold_at: Date.now(),
    search_is_store_item: false,
    updated_at: Date.now(),
    uri: 'url',
    urn: 'urn',
    isSmart: false,
    trade_id: '12',
    wearable_category: WearableCategory.BODY_SHAPE,
    item_type: ItemType.EMOTE_V1,
    body_shapes: [BodyShape.MALE],
    emote_category: EmoteCategory.DANCE,
    description: 'An emote item',
    rarity: Rarity.COMMON,
    loop: true,
    has_sound: true,
    has_geometry: false
  }
})

describe('getCategoryFromDBItem', () => {
  it('should return NFTCategory.WEARABLE for wearable items', () => {
    dbItem = {
      ...dbItem,
      item_type: ItemType.WEARABLE_V1
    }

    const result = getCategoryFromDBItem(dbItem)
    expect(result).toBe(NFTCategory.WEARABLE)
  })

  it('should return NFTCategory.WEARABLE for smart wearable items', () => {
    dbItem = {
      ...dbItem,
      item_type: ItemType.SMART_WEARABLE_V1
    }
    const result = getCategoryFromDBItem(dbItem)
    expect(result).toBe(NFTCategory.WEARABLE)
  })

  it('should return NFTCategory.EMOTE for non-wearable items', () => {
    dbItem = {
      ...dbItem,
      item_type: ItemType.EMOTE_V1
    }
    const result = getCategoryFromDBItem(dbItem)
    expect(result).toBe(NFTCategory.EMOTE)
  })
})

describe('fromDBItemToItem', () => {
  it('should convert DBItem to Item for wearable items', () => {
    dbItem = {
      ...dbItem,
      item_type: ItemType.WEARABLE_V1,
      body_shapes: [BodyShape.MALE],
      emote_category: undefined,
      wearable_category: WearableCategory.BODY_SHAPE,
      description: 'A wearable item',
      rarity: Rarity.COMMON
    }

    const result = fromDBItemToItem(dbItem)

    expect(result).toEqual({
      id: dbItem.id,
      name: dbItem.name,
      thumbnail: dbItem.image,
      url: dbItem.uri,
      category: NFTCategory.WEARABLE,
      contractAddress: dbItem.contract_address,
      itemId: dbItem.item_id,
      rarity: dbItem.rarity,
      price: dbItem.price,
      available: dbItem.available,
      isOnSale: false,
      creator: dbItem.creator,
      beneficiary: dbItem.beneficiary,
      createdAt: dbItem.created_at,
      updatedAt: dbItem.updated_at,
      reviewedAt: dbItem.reviewed_at,
      soldAt: dbItem.sold_at,
      tradeId: dbItem.trade_id,
      data: {
        wearable: {
          bodyShapes: dbItem.body_shapes,
          category: dbItem.wearable_category as WearableCategory,
          description: dbItem.description || '',
          rarity: dbItem.rarity,
          isSmart: dbItem.item_type === ItemType.SMART_WEARABLE_V1
        }
      },
      network: getNetwork(dbItem.network),
      chainId: getNetworkChainId(dbItem.network),
      urn: dbItem.urn,
      firstListedAt: dbItem.first_listed_at?.getTime(),
      picks: { count: 0 },
      minPrice: '0',
      minListingPrice: '0',
      maxListingPrice: '0',
      listings: 0,
      owners: 0,
      utility: ''
    })
  })

  it('should convert DBItem to Item for emote items', () => {
    const result = fromDBItemToItem(dbItem)

    expect(result).toEqual({
      id: dbItem.id,
      name: dbItem.name,
      thumbnail: dbItem.image,
      url: dbItem.uri,
      category: NFTCategory.EMOTE,
      contractAddress: dbItem.contract_address,
      itemId: dbItem.item_id,
      rarity: dbItem.rarity,
      price: dbItem.price,
      available: dbItem.available,
      isOnSale: false,
      tradeId: dbItem.trade_id,
      creator: dbItem.creator,
      beneficiary: dbItem.beneficiary,
      createdAt: dbItem.created_at,
      updatedAt: dbItem.updated_at,
      reviewedAt: dbItem.reviewed_at,
      soldAt: dbItem.sold_at,
      data: {
        emote: {
          bodyShapes: dbItem.body_shapes,
          category: dbItem.emote_category as EmoteCategory,
          description: dbItem.description || '',
          rarity: dbItem.rarity,
          loop: dbItem.loop || false,
          hasSound: dbItem.has_sound || false,
          hasGeometry: dbItem.has_geometry || false
        }
      },
      network: getNetwork(dbItem.network),
      chainId: getNetworkChainId(dbItem.network),
      urn: dbItem.urn,
      firstListedAt: dbItem.first_listed_at?.getTime(),
      picks: { count: 0 },
      minPrice: '0',
      minListingPrice: '0',
      maxListingPrice: '0',
      listings: 0,
      owners: 0,
      utility: ''
    })
  })
})
describe('getDataFromDBItem', () => {
  it('should return wearable data for wearable items', () => {
    dbItem = {
      ...dbItem,
      item_type: ItemType.WEARABLE_V1,
      body_shapes: [BodyShape.FEMALE],
      wearable_category: WearableCategory.UPPER_BODY,
      description: 'A wearable item',
      rarity: Rarity.RARE,
      isSmart: false
    }
    const result = getDataFromDBItem(dbItem)
    expect(result).toEqual({
      wearable: {
        bodyShapes: dbItem.body_shapes,
        category: dbItem.wearable_category,
        description: dbItem.description,
        rarity: dbItem.rarity,
        isSmart: dbItem.isSmart
      }
    })
  })

  it('should return emote data for emote items', () => {
    dbItem = {
      ...dbItem,
      item_type: ItemType.EMOTE_V1,
      body_shapes: [BodyShape.MALE],
      emote_category: EmoteCategory.DANCE,
      description: 'An emote item',
      rarity: Rarity.COMMON,
      loop: true,
      has_sound: true,
      has_geometry: false
    }
    const result = getDataFromDBItem(dbItem)
    expect(result).toEqual({
      emote: {
        bodyShapes: dbItem.body_shapes,
        category: dbItem.emote_category,
        description: dbItem.description,
        rarity: dbItem.rarity,
        loop: dbItem.loop,
        hasSound: dbItem.has_sound,
        hasGeometry: dbItem.has_geometry
      }
    })
  })
})
