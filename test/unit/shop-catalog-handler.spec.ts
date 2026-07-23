import { URL } from 'url'
import { createShopUnifiedHandler } from '../../src/controllers/handlers/shop-catalog-handler'

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
