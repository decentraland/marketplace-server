import { NFTCategory, NFTSortBy } from '@dcl/schemas'
import { getAllLANDsQuery, getLandsOnSaleQuery, getNFTsSortBy, getNFTsSortByOverNFTTable } from '../../src/ports/nfts/landQueries'
import { GetNFTsFilters } from '../../src/ports/nfts/types'

const onSale = (over: Partial<GetNFTsFilters> = {}): GetNFTsFilters =>
  ({ category: NFTCategory.PARCEL, isOnSale: true, first: 24, skip: 0, ...over } as GetNFTsFilters)

/** The text of the trades CTE alone — everything between `unified_trades AS (` and its closing paren. */
function tradesCTE(sql: string): string {
  const start = sql.indexOf('unified_trades AS (')
  expect(start).toBeGreaterThan(-1)
  return sql.slice(start, sql.indexOf(')', sql.indexOf('mv_trades', start)) + 1)
}

describe('when browsing LAND that is on sale', () => {
  describe('and the sort is Recently Listed', () => {
    /**
     * The trades CTE limits itself to one page when it is asked to sort by Recently Listed, which suits a
     * caller reading the trades directly. This query UNIONs them with the on-chain orders and counts the
     * union, so a limit on one side alone made the total "every order + one page of trades": on production
     * it reported 72 parcels at first=1 and 97 at first=48, against a real 194, and everything past the
     * first page of trade-backed LAND was unreachable.
     */
    it('should not limit the trades it unions with the orders', () => {
      const { text } = getLandsOnSaleQuery(onSale({ sortBy: NFTSortBy.RECENTLY_LISTED }))

      expect(tradesCTE(text)).not.toMatch(/LIMIT/i)
      expect(tradesCTE(text)).not.toMatch(/OFFSET/i)
    })

    it('should still page the result itself, so the fix does not turn into an unbounded read', () => {
      const { text } = getLandsOnSaleQuery(onSale({ sortBy: NFTSortBy.RECENTLY_LISTED }))

      expect(text).toMatch(/LIMIT/i)
      expect(text).toMatch(/OFFSET/i)
    })

    it('should order the union by the listing date', () => {
      const { text } = getLandsOnSaleQuery(onSale({ sortBy: NFTSortBy.RECENTLY_LISTED }))

      expect(text).toContain('ORDER BY order_created_at DESC NULLS LAST')
    })
  })

  describe('and a search term is given', () => {
    /**
     * The search used to be applied inside the on-chain-order CTE only. The trades CTE has no nft to match
     * against, so every trade-backed LAND sailed past any term: of the 299 LAND on sale on production, 103
     * are order-backed and 196 trade-backed, and a search for a string matching nothing ("xyzzy") returned
     * exactly those 196. It has to be applied where the two rails are already joined to the nft.
     */
    it('should match the search against the nft over the whole union, not one rail of it', () => {
      const { text, values } = getLandsOnSaleQuery(onSale({ search: 'genesis' }))

      expect(text).toContain('nft.search_text %')
      expect(values).toContain('genesis')
    })

    it('should apply it after the union, where both the orders and the trades are in scope', () => {
      const { text } = getLandsOnSaleQuery(onSale({ search: 'genesis' }))
      const union = text.indexOf('combined AS (')
      const searchOverUnion = text.indexOf('nft.search_text %')

      expect(union).toBeGreaterThan(-1)
      expect(searchOverUnion).toBeGreaterThan(union)
    })

    it('should bind the term rather than inline it', () => {
      const { text, values } = getLandsOnSaleQuery(onSale({ search: "o'brien" }))

      expect(text).not.toContain("o'brien")
      expect(values).toContain("o'brien")
    })
  })

  it('should add no search predicate when nothing was searched for', () => {
    const { text } = getLandsOnSaleQuery(onSale())

    expect(text).not.toContain('nft.search_text %')
  })
})

describe('when browsing every LAND, on sale or not', () => {
  /**
   * `order_created_at` is COMPUTED further down the query, over the union of the nft's cached listing date
   * and the live order/trade. The pre-selection CTE reads the nft table alone, so naming it there is a hard
   * SQL error, not a wrong order: `/v1/nfts?category=parcel&sortBy=recently_listed` answered HTTP 400 with
   * `column "order_created_at" does not exist` for every LAND browse not filtered to on-sale.
   */
  it('should sort the pre-selection by a column the nft table actually has', () => {
    const { text } = getAllLANDsQuery({
      category: NFTCategory.PARCEL,
      sortBy: NFTSortBy.RECENTLY_LISTED,
      first: 24,
      skip: 0
    } as GetNFTsFilters)
    const preselection = text.slice(text.indexOf('top_land AS ('), text.indexOf('open_orders_nfts'))

    expect(preselection).toContain('ORDER BY search_order_created_at DESC NULLS LAST')
    expect(preselection).not.toMatch(/ORDER BY order_created_at/)
  })

  it('should not limit the trades it joins for pricing either', () => {
    const { text } = getAllLANDsQuery({
      category: NFTCategory.PARCEL,
      sortBy: NFTSortBy.RECENTLY_LISTED,
      first: 24,
      skip: 0
    } as GetNFTsFilters)

    expect(tradesCTE(text)).not.toMatch(/LIMIT/i)
  })
})

describe('when mapping a sort onto the nft table alone', () => {
  it('should swap the computed listing column for the cached one', () => {
    expect(getNFTsSortByOverNFTTable(NFTSortBy.RECENTLY_LISTED).text).toContain('search_order_created_at')
  })

  it('should leave every other sort exactly as the shared mapping has it', () => {
    for (const sortBy of [NFTSortBy.NAME, NFTSortBy.NEWEST, NFTSortBy.CHEAPEST, NFTSortBy.RECENTLY_SOLD, undefined]) {
      expect(getNFTsSortByOverNFTTable(sortBy).text).toEqual(getNFTsSortBy(sortBy).text)
    }
  })
})
