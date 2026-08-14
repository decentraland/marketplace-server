import { URL } from 'url'
import {
  createCatalogItemsHandler,
  createShopRelatedHandler,
  createShopTrendingHandler,
  createShopUnifiedHandler
} from '../../src/controllers/handlers/shop-catalog-handler'

// The unified handler is a factory: createShopUnifiedHandler(components) -> (context) => response. These
// tests drive the `groupBy` dispatch (per-listing default vs item-unified) and confirm the parsed filters
// reach the component unchanged.
describe('when handling the unified shop catalog endpoint', () => {
  let getUnifiedListings: jest.Mock
  let getShopItems: jest.Mock
  let getRate: jest.Mock
  let handler: ReturnType<typeof createShopUnifiedHandler>

  const noop = jest.fn()
  const invoke = (url: string) => handler({ url: new URL(url), request: {} } as any, noop)

  beforeEach(() => {
    getUnifiedListings = jest.fn().mockResolvedValue({ data: [{ tradeId: 'listing-1' }], total: 1 })
    getShopItems = jest.fn().mockResolvedValue({ data: [{ tradeId: 'item-1', listingCount: 3 }], total: 1 })
    getRate = jest.fn().mockReturnValue(0.5)
    const components = {
      shopCatalog: { getUnifiedListings, getShopItems },
      manaUsdRate: { getRate }
    } as any
    handler = createShopUnifiedHandler(components)
  })

  describe('and no groupBy is provided', () => {
    it('should default to the per-listing feed (getUnifiedListings)', async () => {
      const result = await invoke('http://localhost/v3/catalog/unified')

      expect(getUnifiedListings).toHaveBeenCalledTimes(1)
      expect(getShopItems).not.toHaveBeenCalled()
      expect(result.body).toEqual({ data: [{ tradeId: 'listing-1' }], total: 1 })
    })
  })

  describe('and groupBy=item is provided', () => {
    it('should dispatch to the item-unified feed (getShopItems) with the live rate', async () => {
      const result = await invoke('http://localhost/v3/catalog/unified?groupBy=item')

      expect(getShopItems).toHaveBeenCalledTimes(1)
      expect(getUnifiedListings).not.toHaveBeenCalled()
      expect(getShopItems.mock.calls[0][1]).toBe(0.5)
      expect(result.body).toEqual({ data: [{ tradeId: 'item-1', listingCount: 3 }], total: 1 })
    })
  })

  describe('and an unknown groupBy is provided', () => {
    it('should fall back to the per-listing feed', async () => {
      await invoke('http://localhost/v3/catalog/unified?groupBy=bogus')

      expect(getUnifiedListings).toHaveBeenCalledTimes(1)
      expect(getShopItems).not.toHaveBeenCalled()
    })
  })

  describe('and browse filters are provided with groupBy=item', () => {
    it('should forward the parsed filters to getShopItems', async () => {
      await invoke(
        'http://localhost/v3/catalog/unified?groupBy=item&category=emote&rarity=Rare,EPIC&minPriceCredits=3&maxPriceCredits=10&source=native&sortBy=cheapest&search=cool'
      )

      expect(getShopItems.mock.calls[0][0]).toMatchObject({
        category: 'emote',
        rarities: ['Rare', 'EPIC'],
        minPriceCredits: 3,
        maxPriceCredits: 10,
        source: 'native',
        sortBy: 'cheapest',
        search: 'cool'
      })
    })
  })

  // Two encodings reach this feed: its own comma-separated lists (`rarity`, `wearableCategory`) and the
  // repeated form /v1/items takes, which is where `wearableGender` and its values come from. A caller
  // reaching for the wrong one used to get an unfiltered page that still looked filtered, so both are
  // accepted and anything else is dropped.
  describe('and a wearable gender is provided', () => {
    const gendersOf = () => getUnifiedListings.mock.calls[0][0].wearableGenders

    it('should parse a single value', async () => {
      await invoke('http://localhost/v3/catalog/unified?wearableGender=male')

      expect(gendersOf()).toEqual(['male'])
    })

    it("should parse this feed's comma-separated form", async () => {
      await invoke('http://localhost/v3/catalog/unified?wearableGender=male,female')

      expect(gendersOf()).toEqual(['male', 'female'])
    })

    it('should parse the repeated form without duplicating the first value', async () => {
      await invoke('http://localhost/v3/catalog/unified?wearableGender=male&wearableGender=female')

      expect(gendersOf()).toEqual(['male', 'female'])
    })

    it('should drop unknown values rather than ask for a body shape no item declares', async () => {
      await invoke('http://localhost/v3/catalog/unified?wearableGender=bogus')

      expect(gendersOf()).toBeUndefined()
    })

    it('should leave the filter off when absent, so the pre-existing response is unchanged', async () => {
      await invoke('http://localhost/v3/catalog/unified')

      expect(gendersOf()).toBeUndefined()
    })
  })

  describe('and includeSocialEmotes is provided', () => {
    it('should exclude social emotes only on an explicit false', async () => {
      await invoke('http://localhost/v3/catalog/unified?groupBy=item&includeSocialEmotes=false')
      expect(getShopItems.mock.calls[0][0].includeSocialEmotes).toBe(false)
    })

    it('should include them when absent, so the pre-existing response is unchanged', async () => {
      await invoke('http://localhost/v3/catalog/unified?groupBy=item')
      expect(getShopItems.mock.calls[0][0].includeSocialEmotes).toBe(true)
    })

    it('should include them for any value other than the literal false', async () => {
      // `Params.getBoolean` is presence-based, so reading this flag through it would turn
      // `includeSocialEmotes=false` into `true` -- the exact inversion that matters.
      await invoke('http://localhost/v3/catalog/unified?groupBy=item&includeSocialEmotes=true')
      expect(getShopItems.mock.calls[0][0].includeSocialEmotes).toBe(true)
    })
  })
})

// The trending handler backs the Shop home's Trending row. What matters here is that the row's two
// non-negotiables -- no social emotes, no resales -- travel from the query string to the component, and that
// the response is cached rather than recomputed per visitor.
describe('when handling the trending items endpoint', () => {
  let getTrendingItems: jest.Mock
  let getRate: jest.Mock
  let handler: ReturnType<typeof createShopTrendingHandler>

  const noop = jest.fn()
  const invoke = (url: string) => handler({ url: new URL(url), request: {} } as any, noop)

  beforeEach(() => {
    getTrendingItems = jest.fn().mockResolvedValue({ data: [{ tradeId: 'trending-1', trendingSales: 9 }] })
    getRate = jest.fn().mockReturnValue(0.5)
    handler = createShopTrendingHandler({ shopCatalog: { getTrendingItems }, manaUsdRate: { getRate } } as any)
  })

  it('should return the rail with the live rate applied and no total', async () => {
    const result = await invoke('http://localhost/v3/catalog/trending')

    expect(getTrendingItems).toHaveBeenCalledTimes(1)
    expect(getTrendingItems.mock.calls[0][1]).toBe(0.5)
    expect(result.body).toEqual({ data: [{ tradeId: 'trending-1', trendingSales: 9 }] })
  })

  it('should default the size and the window to the rail defaults', async () => {
    await invoke('http://localhost/v3/catalog/trending')

    expect(getTrendingItems.mock.calls[0][0]).toMatchObject({ first: 12, days: 1 })
  })

  it('should pass an explicit size and window through for the component to clamp', async () => {
    await invoke('http://localhost/v3/catalog/trending?first=30&days=7')

    expect(getTrendingItems.mock.calls[0][0]).toMatchObject({ first: 30, days: 7 })
  })

  it('should exclude social emotes only on an explicit includeSocialEmotes=false', async () => {
    await invoke('http://localhost/v3/catalog/trending?includeSocialEmotes=false')
    expect(getTrendingItems.mock.calls[0][0].includeSocialEmotes).toBe(false)

    getTrendingItems.mockClear()
    await invoke('http://localhost/v3/catalog/trending')
    expect(getTrendingItems.mock.calls[0][0].includeSocialEmotes).toBe(true)
  })

  it('should forward listingType so a client that does not sell resales can exclude them server-side', async () => {
    await invoke('http://localhost/v3/catalog/trending?listingType=primary')

    expect(getTrendingItems.mock.calls[0][0].listingType).toBe('primary')
  })

  it('should reject an unknown listingType rather than silently returning resales too', async () => {
    await invoke('http://localhost/v3/catalog/trending?listingType=primaries')

    expect(getTrendingItems.mock.calls[0][0].listingType).toBeUndefined()
  })

  it('should forward the browse filters the rail supports', async () => {
    await invoke('http://localhost/v3/catalog/trending?category=emote&rarity=Rare,EPIC&wearableCategory=hat&source=native')

    expect(getTrendingItems.mock.calls[0][0]).toMatchObject({
      category: 'emote',
      rarities: ['Rare', 'EPIC'],
      wearableCategories: ['hat'],
      source: 'native'
    })
  })

  it('should cache the rail for an hour instead of recomputing it per visitor', async () => {
    const result = await invoke('http://localhost/v3/catalog/trending')

    expect(result.headers).toMatchObject({ 'Cache-Control': 'public,max-age=3600,s-maxage=3600' })
  })
})

// The related handler answers the PDP's fallback rail. These tests cover what it lets through to the
// component and, above all, what it refuses to guess when the anchor item is not fully identified.
describe('when handling the related items endpoint', () => {
  const CONTRACT = '0x1234567890123456789012345678901234567890'
  let getRelatedItems: jest.Mock
  let getRate: jest.Mock
  let handler: ReturnType<typeof createShopRelatedHandler>

  const noop = jest.fn()
  const invoke = (url: string) => handler({ url: new URL(url), request: {} } as any, noop)

  beforeEach(() => {
    getRelatedItems = jest.fn().mockResolvedValue({ data: [{ tradeId: 'related-1' }] })
    getRate = jest.fn().mockReturnValue(0.5)
    handler = createShopRelatedHandler({ shopCatalog: { getRelatedItems }, manaUsdRate: { getRate } } as any)
  })

  describe('and the anchor item is fully identified', () => {
    it('should forward the anchor and the live rate, and return the rail', async () => {
      const result = await invoke(`http://localhost/v3/catalog/related?contractAddress=${CONTRACT}&itemId=3`)

      expect(getRelatedItems).toHaveBeenCalledTimes(1)
      expect(getRelatedItems.mock.calls[0][0]).toMatchObject({ contractAddress: CONTRACT, itemId: '3' })
      expect(getRelatedItems.mock.calls[0][1]).toBe(0.5)
      expect(result.body).toEqual({ data: [{ tradeId: 'related-1' }] })
    })

    it('should default the limit to the related rail size', async () => {
      await invoke(`http://localhost/v3/catalog/related?contractAddress=${CONTRACT}&itemId=3`)

      expect(getRelatedItems.mock.calls[0][0].first).toBe(10)
    })

    it('should pass an explicit limit through for the component to clamp', async () => {
      await invoke(`http://localhost/v3/catalog/related?contractAddress=${CONTRACT}&itemId=3&first=20`)

      expect(getRelatedItems.mock.calls[0][0].first).toBe(20)
    })
  })

  describe('and the anchor item is missing or malformed', () => {
    it('should return an empty rail without querying when the itemId is absent', async () => {
      const result = await invoke(`http://localhost/v3/catalog/related?contractAddress=${CONTRACT}`)

      expect(getRelatedItems).not.toHaveBeenCalled()
      expect(result.body).toEqual({ data: [] })
    })

    it('should return an empty rail without querying when the contractAddress is absent', async () => {
      const result = await invoke('http://localhost/v3/catalog/related?itemId=3')

      expect(getRelatedItems).not.toHaveBeenCalled()
      expect(result.body).toEqual({ data: [] })
    })

    it('should return an empty rail when the contractAddress is not an address', async () => {
      // Params.getAddress validates the shape, so a junk contract never reaches a query.
      const result = await invoke('http://localhost/v3/catalog/related?contractAddress=not-an-address&itemId=3')

      expect(getRelatedItems).not.toHaveBeenCalled()
      expect(result.body).toEqual({ data: [] })
    })

    /**
     * A non-numeric itemId used to reach the query, where `blockchain_id = ${itemId}::numeric` made Postgres
     * raise `invalid input syntax for type numeric` — a 500 from a public GET, for a request this endpoint
     * promises to answer with an empty rail. Asserting `not.toHaveBeenCalled()` is the point: being rejected
     * in the handler is what keeps it away from SQL.
     *
     * Reachable from a bad URL, not only from a hand-written request: the Shop takes the id from
     * `/item/:contractAddress/:itemId`, so a malformed deep link would have 500'd the rail.
     */
    it.each(['abc', '1e3', '-1', '1.5', '3; DROP TABLE item', ' ', '0x03'])(
      'should return an empty rail without querying for the non-numeric itemId %p',
      async itemId => {
        const result = await invoke(`http://localhost/v3/catalog/related?contractAddress=${CONTRACT}&itemId=${encodeURIComponent(itemId)}`)

        expect(getRelatedItems).not.toHaveBeenCalled()
        expect(result.body).toEqual({ data: [] })
      }
    )

    it('should still accept a large numeric itemId, which is a plain blockchain id and not junk', async () => {
      // The guard must not reject legitimate ids: blockchain ids are unbounded integers, well past 2^53.
      const big = '90071992547409910000'

      await invoke(`http://localhost/v3/catalog/related?contractAddress=${CONTRACT}&itemId=${big}`)

      expect(getRelatedItems).toHaveBeenCalledTimes(1)
      expect(getRelatedItems.mock.calls[0][0]).toMatchObject({ itemId: big })
    })
  })
})

// The catalog-items handler answers the full-catalog (incl. not-for-sale) credit-aware feed the Shop's
// creator storefront and browse "All" grid read. On top of the /v1/items params it parses a sort and a
// CREDIT-denominated price range, so these tests pin what reaches the component.
describe('when handling the catalog items endpoint', () => {
  let getCatalogItems: jest.Mock
  let getRate: jest.Mock
  let handler: ReturnType<typeof createCatalogItemsHandler>

  const noop = jest.fn()
  const invoke = (url: string) => handler({ url: new URL(url), request: {} } as any, noop)

  beforeEach(() => {
    getCatalogItems = jest.fn().mockResolvedValue({ data: [{ id: 'item-1', priceCredits: 4 }], total: 1 })
    getRate = jest.fn().mockReturnValue(0.5)
    handler = createCatalogItemsHandler({ items: { getCatalogItems }, manaUsdRate: { getRate } } as any)
  })

  describe('and a creator is provided', () => {
    it('should forward the creator and return the data/total envelope', async () => {
      const result = await invoke('http://localhost/v3/catalog/items?creator=0xCREATOR')

      expect(getCatalogItems.mock.calls[0][0]).toMatchObject({ creator: ['0xCREATOR'] })
      expect(getCatalogItems.mock.calls[0][1]).toBe(0.5)
      expect(result.body).toEqual({ data: [{ id: 'item-1', priceCredits: 4 }], total: 1 })
    })

    it('should leave isOnSale unset so items are listed whether or not they are for sale', async () => {
      await invoke('http://localhost/v3/catalog/items?creator=0xCREATOR')

      expect(getCatalogItems.mock.calls[0][0].isOnSale).toBeUndefined()
    })
  })

  describe('and a sort is provided', () => {
    it('should forward a supported sort', async () => {
      await invoke('http://localhost/v3/catalog/items?sortBy=most_expensive')

      expect(getCatalogItems.mock.calls[0][0].sortBy).toBe('most_expensive')
    })

    it('should drop an unsupported sort rather than reach ORDER BY with it', async () => {
      await invoke('http://localhost/v3/catalog/items?sortBy=recently_listed')

      expect(getCatalogItems.mock.calls[0][0].sortBy).toBeUndefined()
    })
  })

  describe('and a credit price range is provided', () => {
    it('should forward both credit bounds as numbers', async () => {
      await invoke('http://localhost/v3/catalog/items?minPriceCredits=2&maxPriceCredits=30')

      expect(getCatalogItems.mock.calls[0][0]).toMatchObject({ minPriceCredits: 2, maxPriceCredits: 30 })
    })

    it('should leave the credit bounds unset when absent, so no range is applied', async () => {
      await invoke('http://localhost/v3/catalog/items')

      expect(getCatalogItems.mock.calls[0][0].minPriceCredits).toBeUndefined()
      expect(getCatalogItems.mock.calls[0][0].maxPriceCredits).toBeUndefined()
    })
  })

  describe('and isOnSale=false is provided', () => {
    it('should forward false (not undefined) so the component can negate the on-sale predicate', async () => {
      await invoke('http://localhost/v3/catalog/items?isOnSale=false')

      expect(getCatalogItems.mock.calls[0][0].isOnSale).toBe(false)
    })
  })
})
