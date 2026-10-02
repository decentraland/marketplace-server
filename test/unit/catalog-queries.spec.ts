import {
  getCollectionsItemsCatalogQuery,
  getCollectionsItemsCatalogQueryWithTrades,
  getCollectionsItemsCountQuery,
  getItemIdsBySearchTextQuery,
  getTradesCTE
} from '../../src/ports/catalog/queries'
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
      const text = getCollectionsItemsCatalogQueryWithTrades(filters, []).text
      expect(text).not.toContain('json_agg')
      expect(text).not.toContain('aggregated_assets')
    })

    it('should still compute the offchain order aggregates the query actually reads', () => {
      const text = getCollectionsItemsCatalogQueryWithTrades(filters, []).text
      expect(text).toContain('nfts_listings_count')
      expect(text).toContain('open_item_trade_price')
      expect(text).toContain('item_first_listed_at')
    })

    // id, price and paused ride in one MAX key, so they always describe the same trade: unpaused first, then newest.
    it('should pick the open item trade by a single key that sorts unpaused trades first, then the newest', () => {
      const text = getCollectionsItemsCatalogQueryWithTrades(filters, []).text
      expect(text).toContain(
        "MAX((CASE WHEN paused THEN '0' ELSE '1' END || to_char(created_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') || id::text || '|' || COALESCE(amount_received::text, '')) COLLATE \"C\") FILTER (WHERE status = 'open' and type = 'public_item_order') AS open_item_trade_key"
      )
    })

    it('should read the id, price and paused flag of that trade off its key', () => {
      const text = getCollectionsItemsCatalogQueryWithTrades(filters, []).text
      expect(text).toContain('substr(grouped_trades.open_item_trade_key, 22, 36) AS open_item_trade_id')
      expect(text).toContain("NULLIF(split_part(grouped_trades.open_item_trade_key, '|', 2), '')::numeric AS open_item_trade_price")
      expect(text).toContain("left(grouped_trades.open_item_trade_key, 1) = '0' AS open_item_trade_paused")
    })

    // Product decision: a paused listing keeps counting towards the item's prices and listing counts.
    it('should not exclude paused trades from the offchain order aggregates', () => {
      const text = getCollectionsItemsCatalogQueryWithTrades(filters, []).text
      expect(text).not.toMatch(/NOT\s+paused|paused\s*=\s*false/)
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

describe('when building the search text query', () => {
  let filters: CatalogQueryFilters

  beforeEach(() => {
    filters = { search: 'Cool Hat', first: 20, skip: 0 }
  })

  it('should match names against the pre-split search words table rather than exploding them per request', () => {
    const text = getItemIdsBySearchTextQuery(filters).text

    expect(text).toContain('item_search_words')
    expect(text).toContain('search_words.word % lower(')
    expect(text).not.toContain('string_to_array')
    expect(text).not.toContain('latest_metadata')
  })

  it('should bind every occurrence of the search term instead of inlining it', () => {
    const query = getItemIdsBySearchTextQuery(filters)

    expect(query.text).not.toContain('Cool Hat')
    expect(query.values).toContain('Cool Hat')
    expect(query.values.every(value => value === 'Cool Hat')).toBe(true)
  })

  it('should report the word with its original casing, so search analytics keep the name as written', () => {
    expect(getItemIdsBySearchTextQuery(filters).text).toContain('search_words.original_word')
  })

  it('should order deterministically, so paging through ties cannot repeat or drop an item', () => {
    expect(getItemIdsBySearchTextQuery(filters).text).toMatch(/ORDER BY word_similarity DESC,\s*id/)
  })
})

describe('when building the trades CTE', () => {
  it('should not restrict the trades when no item ids are given', () => {
    const text = getTradesCTE({ pausedContracts: [] }).text

    expect(text).not.toContain('trade_items')
    expect(text).not.toContain('WHERE')
  })

  it('should restrict the trades to the given items so the whole view is not materialized', () => {
    const query = getTradesCTE({ itemIds: ['0xabc-1', '0xabc-2'], pausedContracts: [] })

    expect(query.text).toContain('EXISTS')
    expect(query.text).toContain('trade_items.collection_id = mv_trades.contract_address_sent')
    // must match the downstream join's comparison, or this filter would drop trades the join accepts
    expect(query.text).toContain('trade_items.blockchain_id = mv_trades.sent_item_id::numeric')
    expect(query.values).toEqual([['0xabc-1', '0xabc-2']])
  })

  describe('and no marketplace contract is paused', () => {
    let text: string

    beforeEach(() => {
      text = getTradesCTE({ pausedContracts: [] }).text
    })

    it('should flag every trade as not paused without reading any status table', () => {
      expect(text).toContain('SELECT mv_trades.*, false AS paused from marketplace.mv_trades')
    })
  })

  describe('and a marketplace contract is paused', () => {
    let text: string
    let values: unknown[]

    beforeEach(() => {
      const query = getTradesCTE({ pausedContracts: [{ address: '0xabc', network: 'MATIC' }] })
      text = query.text
      values = query.values
    })

    it('should flag the trades whose contract and network are in the paused set', () => {
      expect(text).toContain(
        "SELECT mv_trades.*, (LOWER(mv_trades.trade_contract) || '-' || mv_trades.network) = ANY($1::text[]) AS paused"
      )
    })

    it('should bind the paused set as contract-network keys', () => {
      expect(values).toEqual([['0xabc-MATIC']])
    })
  })

  it('should ignore an empty item id list rather than emitting an unsatisfiable condition', () => {
    expect(getTradesCTE({ itemIds: [], pausedContracts: [] }).text).not.toContain('trade_items')
  })

  it('should keep the category filter and the recently-listed window working alongside an item restriction', () => {
    const text = getTradesCTE({ itemIds: ['0xabc-1'], category: 'wearable' as never, pausedContracts: [] }).text

    expect(text).toMatch(/WHERE sent_nft_category = \$\d+\s+AND EXISTS/)
  })
})

describe('when building the count query', () => {
  it('should collect the open orders once for the candidate items instead of probing per row', () => {
    const text = getCollectionsItemsCountQuery({ ids: ['0xabc-1'], isOnSale: true, first: 20, skip: 0 }).text

    expect(text).toContain('WITH open_orders AS MATERIALIZED')
    expect(text).toContain('open_orders AS o')
  })

  it('should not declare the open orders CTE when nothing in the query reads it', () => {
    const query = getCollectionsItemsCountQuery({ ids: ['0xabc-1'], first: 20, skip: 0 })

    expect(query.text).not.toContain('open_orders')
    // and the id array is bound once, not twice
    expect(query.values.filter(value => Array.isArray(value))).toHaveLength(1)
  })

  it('should read the order table directly when there are no candidate ids to narrow it down', () => {
    const text = getCollectionsItemsCountQuery({ isOnSale: true, first: 20, skip: 0 }).text

    expect(text).not.toContain('open_orders')
    expect(text).toContain('.order AS o')
  })
})
