import { NFTCategory } from '@dcl/schemas'
import { getItemsParams } from '../../src/controllers/handlers/utils'
import { Params } from '../../src/logic/http/params'
import { getCatalogItemsQuery, getItemsQuery } from '../../src/ports/items/queries'
import { ItemQueryFilters } from '../../src/ports/items/types'

// The name expression the shop feeds agree on, whitespace-tolerant.
const NAME_ILIKE = /COALESCE\(\s*wearable\.name\s*,\s*emote\.name\s*\)\s*ILIKE/i
// The WHERE-clause form specifically -- the price_credits SELECT mentions the same columns.
const ON_SALE = /\(\(\(unified_trades\.id IS NOT NULL AND item\.search_is_marketplace_v3_minter = true\)/i

describe('when building the items queries', () => {
  let filters: ItemQueryFilters

  beforeEach(() => {
    filters = { first: 20, skip: 0 }
  })

  describe('and filtering by search text', () => {
    it('should match the item name term by term against the word table, so a term is found wherever it sits in the name', () => {
      const query = getCatalogItemsQuery({ ...filters, search: 'chapeau' })
      expect(query.text).toContain('marketplace.item_search_words')
      expect(query.text).toContain('t.term <% w.word')
      expect(query.text).toContain('LEFT JOIN search_matches AS search_match ON search_match.item_id = item.id::text')
      expect(query.text).toContain('(item.id::text IN (SELECT item_id FROM search_matches))')
      expect(query.text).not.toContain('search_text')
      expect(query.values).toContain('chapeau')
    })

    it('should also match the item tags, which is where brand and collab names live', () => {
      const query = getCatalogItemsQuery({ ...filters, search: 'chapeau' })
      expect(query.text).toContain('lower(tags.tag) = lower(')
    })

    it('should open the search CTEs alongside the trades one, since a statement has a single WITH', () => {
      const query = getCatalogItemsQuery({ ...filters, search: 'chapeau' })
      expect(query.text).toMatch(/WITH \w+ AS \([\s\S]*\), search_terms AS \(/)
    })

    it('should keep the best-matching rows of the FILTERED set and count above that filter', () => {
      const query = getCatalogItemsQuery({ ...filters, search: 'chapeau', category: NFTCategory.WEARABLE })
      expect(query.text).toContain('MAX(c.search_matched) OVER () AS search_required')
      expect(query.text).toContain('WHERE f.search_matched IS NULL OR f.search_matched >= f.search_required')
      // the count is no longer inside the core SELECT, where it would count rows the level then drops
      expect(query.text.indexOf('COUNT(*) OVER () AS count')).toBeLessThan(query.text.indexOf('search_required'))
      expect(query.text).not.toContain('COUNT(*) OVER() as count')
    })

    it('should default a search to relevance, reading the sort keys off the level-filtered relation', () => {
      const query = getCatalogItemsQuery({ ...filters, search: 'chapeau' })
      expect(query.text).toContain('ORDER BY f.search_matched DESC NULLS LAST, f.search_score DESC NULLS LAST, f.created_at DESC, f.id ASC')
    })

    it('should honour an explicit sort on a search, spelled on the output columns the wrapper exposes', () => {
      const query = getCatalogItemsQuery({ ...filters, search: 'chapeau', sortBy: 'cheapest' })
      expect(query.text).toContain('ORDER BY NULLIF(f.price_credits, 0) ASC NULLS LAST, f.id ASC')
    })

    it('should treat relevance without a search as newest, since every row would tie', () => {
      const query = getCatalogItemsQuery({ ...filters, sortBy: 'relevance' })
      expect(query.text).toContain('ORDER BY item.created_at DESC, item.id ASC')
      expect(query.text).not.toContain('search_matches')
      expect(query.text).toContain('COUNT(*) OVER() as count')
    })

    it('should not match a literal substring of the whole name: that returned nothing for multi-word terms', () => {
      const query = getCatalogItemsQuery({ ...filters, search: 'hat pirate' })
      expect(query.text).not.toMatch(NAME_ILIKE)
      expect(query.values).not.toContain('%hat pirate%')
    })

    it('should carry LIKE metacharacters as plain data now that nothing builds a LIKE pattern', () => {
      const query = getCatalogItemsQuery({ ...filters, search: '50%_off\\' })
      expect(query.values).toContain('50%_off\\')
    })

    it('should apply the same rule to the /v1/items feed', () => {
      const query = getItemsQuery({ ...filters, search: 'chapeau' })
      expect(query.text).toContain('marketplace.item_search_words')
      expect(query.text).not.toMatch(NAME_ILIKE)
      expect(query.text).not.toContain('search_text')
    })
  })

  describe('and filtering by sale status', () => {
    it('should keep only buyable items when isOnSale is true', () => {
      const query = getCatalogItemsQuery({ ...filters, isOnSale: true })
      expect(query.text).toMatch(ON_SALE)
      expect(query.text).not.toMatch(/NOT\s+\(\(\(unified_trades/i)
    })

    it('should return the complement when isOnSale is false, so "not for sale" is not a no-op', () => {
      const query = getCatalogItemsQuery({ ...filters, isOnSale: false })
      expect(query.text).toMatch(/NOT\s+\(\(\(unified_trades/i)
    })

    it('should not filter by status at all when isOnSale is undefined', () => {
      const query = getCatalogItemsQuery(filters)
      expect(query.text).not.toMatch(ON_SALE)
    })
  })

  describe('and paginating the catalog-items feed', () => {
    it('should order by a total key so LIMIT/OFFSET pages cannot repeat or skip items', () => {
      const query = getCatalogItemsQuery(filters)
      expect(query.text).toMatch(/ORDER BY item\.created_at DESC, item\.id ASC[\s\S]*LIMIT/i)
    })
  })
})

describe('when parsing the items query params', () => {
  const parse = (search: string) => getItemsParams(new Params(new URLSearchParams(search)))

  it('should read isOnSale=true as on sale', () => {
    expect(parse('isOnSale=true').isOnSale).toBe(true)
  })

  it('should read isOnSale=false as not for sale', () => {
    expect(parse('isOnSale=false').isOnSale).toBe(false)
  })

  it('should treat a valueless isOnSale as absent rather than as false', () => {
    expect(parse('isOnSale=').isOnSale).toBeUndefined()
  })

  it('should leave isOnSale unset when the param is missing', () => {
    expect(parse('').isOnSale).toBeUndefined()
  })
})

/**
 * A primary listing is a `public_item_order`, and in `mv_trades` those carry `sent_nft_category = NULL`
 * — the column is populated from the NFT join, which an item order does not have. Narrowing the trades
 * CTE by category therefore matched none of them, and every item on sale came back with no trade, no
 * price and isOnSale false the moment a caller passed `category`. Measured against production before the
 * fix: 41 of 60 rows on sale became 0.
 */
describe('when the caller filters an item feed by category', () => {
  const withCategory = { first: 20, skip: 0, category: NFTCategory.WEARABLE }

  describe.each([
    ['the catalog items feed', getCatalogItemsQuery],
    ['the v1 items feed', getItemsQuery]
  ])('and building %s', (_name, buildQuery) => {
    it('should not narrow the trades CTE by category, which would drop every primary listing', () => {
      expect(buildQuery(withCategory).text).not.toContain('sent_nft_category')
    })

    it('should still restrict the items themselves to that category', () => {
      expect(buildQuery(withCategory).text).toContain('LOWER(item.item_type) = ANY')
    })
  })
})

/**
 * An item can have more than one OPEN `public_item_order` — five do in production. A plain join emitted
 * the item once per trade: duplicate tiles, a `COUNT(*) OVER()` total inflated by the extras, and a price
 * read from whichever row came back first. Only visible once the category filter above stopped removing
 * every trade, which is why it is pinned here.
 */
describe('when an item has more than one open primary listing', () => {
  describe.each([
    ['the catalog items feed', getCatalogItemsQuery],
    ['the v1 items feed', getItemsQuery]
  ])('and building %s', (_name, buildQuery) => {
    const { text } = buildQuery({ first: 20, skip: 0 })

    it('should join at most one trade per item, so the item cannot be emitted twice', () => {
      expect(text).toContain('LEFT JOIN LATERAL')
      expect(text).toMatch(/ORDER BY\s+id::text DESC\s+LIMIT 1/)
    })

    it('should pick the same trade /v2/catalog does, so the two feeds cannot quote different prices', () => {
      // That feed collapses with MAX(id::text); ordering by the same expression picks the same row.
      expect(text).toMatch(/ORDER BY\s+id::text DESC/)
    })

    it('should still restrict the join to an open primary listing', () => {
      expect(text).toContain("type = 'public_item_order'")
      expect(text).toContain("status = 'open'")
    })
  })
})
