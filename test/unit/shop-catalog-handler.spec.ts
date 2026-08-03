import { URL } from 'url'
import { createShopRelatedHandler, createShopUnifiedHandler } from '../../src/controllers/handlers/shop-catalog-handler'

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
