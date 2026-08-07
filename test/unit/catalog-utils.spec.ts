import { Network } from '@dcl/schemas'
import { CollectionsItemDBResult } from '../../src/ports/catalog/types'
import { fromCollectionsItemDbResultToCatalogItem } from '../../src/ports/catalog/utils'

/**
 * THE UNIT THE CATALOG'S `price` IS IN.
 *
 * A v3 trade can be priced in USD-pegged MANA, in which case `price` is USD wei and rendering it with a
 * MANA glyph makes the item look a fraction of its cost. The number alone cannot say which it is, so the
 * trade has to travel with it — and only when the trade is what set the price, or a consumer would
 * mislabel a perfectly correct MANA figure as dollars.
 */
function dbItem(overrides: Partial<CollectionsItemDBResult> = {}): CollectionsItemDBResult {
  return {
    id: '0xcollection-0',
    urn: 'urn:decentraland:matic:collections-v2:0xcollection:0',
    image: '',
    collection_id: '0xcollection',
    blockchain_id: '0',
    rarity: 'legendary',
    item_type: 'wearable_v2',
    price: '1000000000000000000000',
    available: '43',
    search_is_store_minter: false,
    search_is_marketplace_v3_minter: true,
    creator: '0xcreator',
    beneficiary: '0xcreator',
    created_at: '1',
    updated_at: '1',
    reviewed_at: '1',
    sold_at: '1',
    first_listed_at: '1',
    min_listing_price: null,
    max_listing_price: null,
    open_item_trade_id: 'trade-1',
    open_item_trade_price: '20100000000000000000',
    listings_count: 0,
    owners_count: 0,
    min_price: '0',
    max_price: '0',
    network: 'POLYGON',
    metadata: {
      id: 'm1',
      description: '',
      category: 'upper_body',
      body_shapes: [],
      rarity: 'legendary',
      name: 'Grill Angel'
    },
    ...overrides
  }
}

describe('when mapping a catalog row whose price comes from an open trade', () => {
  it('should carry the trade id so the caller can resolve the unit', () => {
    const item = fromCollectionsItemDbResultToCatalogItem(dbItem(), Network.MATIC)

    expect(item.tradeId).toBe('trade-1')
    expect(item.price).toBe('20100000000000000000')
    expect(item.isOnSale).toBe(true)
  })
})

describe('when the price does not come from a trade', () => {
  /**
   * The case that makes this conditional rather than unconditional: an item still sold by the store
   * minter is priced in MANA from `item.price`, even with an open trade alongside it. Handing out the
   * trade id there would have a caller read a correct MANA figure as dollars.
   */
  it('should omit the trade id when the store minter set the price', () => {
    const item = fromCollectionsItemDbResultToCatalogItem(
      dbItem({ search_is_marketplace_v3_minter: false, search_is_store_minter: true }),
      Network.MATIC
    )

    expect(item.tradeId).toBeUndefined()
    expect(item.price).toBe('1000000000000000000000')
  })

  it('should omit the trade id when nothing is available to sell', () => {
    const item = fromCollectionsItemDbResultToCatalogItem(dbItem({ available: '0' }), Network.MATIC)

    expect(item.tradeId).toBeUndefined()
    expect(item.price).toBe('0')
    expect(item.isOnSale).toBe(false)
  })

  it('should omit the trade id when there is no open trade', () => {
    const item = fromCollectionsItemDbResultToCatalogItem(
      dbItem({ open_item_trade_id: null, open_item_trade_price: null, search_is_store_minter: true }),
      Network.MATIC
    )

    expect(item.tradeId).toBeUndefined()
    expect(item.price).toBe('1000000000000000000000')
  })
})
