import { getCollectionsItemsCatalogQuery, getCollectionsItemsCatalogQueryWithTrades } from '../../src/ports/catalog/queries'
import { CatalogQueryFilters } from '../../src/ports/catalog/types'

// Whitespace-tolerant matcher for a reintroduced window aggregate (COUNT(*) OVER ( ... )).
const COUNT_OVER = /COUNT\(\s*\*\s*\)\s*OVER\s*\(/i

describe('when building the catalog queries', () => {
  let filters: CatalogQueryFilters

  beforeEach(() => {
    filters = { first: 20, skip: 0 }
  })

  describe('and building the v2 (with-trades) catalog query', () => {
    it('should not build the json_agg(assets) aggregate: it was never consumed and is expensive over all grouped trades', () => {
      const text = getCollectionsItemsCatalogQueryWithTrades(filters).text
      expect(text).not.toContain('json_agg')
      expect(text).not.toContain('aggregated_assets')
    })

    it('should still compute the offchain order aggregates the query actually reads', () => {
      const text = getCollectionsItemsCatalogQueryWithTrades(filters).text
      expect(text).toContain('nfts_listings_count')
      expect(text).toContain('open_item_trade_price')
      expect(text).toContain('item_first_listed_at')
    })
  })

  describe('and building the v1 catalog query', () => {
    it('should not compute a COUNT(*) OVER() total_rows window: it was never read (the total comes from the count query)', () => {
      const text = getCollectionsItemsCatalogQuery(filters).text
      expect(text).not.toMatch(COUNT_OVER)
      expect(text).not.toContain('total_rows')
    })
  })
})
