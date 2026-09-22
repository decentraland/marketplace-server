import SQL from 'sql-template-strings'
import {
  applySearchLevel,
  getRelevanceOrderBy,
  getSearchCteDefinitions,
  getSearchMatchJoin,
  getSearchMatchWhere,
  getSearchScoreColumns,
  resolveShopSortBy
} from '../../src/logic/catalog/search-match'

describe('when building the search CTEs', () => {
  it('should split the query with the SQL normalizer, so the terms are shaped exactly like the stored words', () => {
    const { text, values } = getSearchCteDefinitions('Pirate Hat')

    expect(text).toContain('unnest(marketplace.search_query_terms(')
    expect(values).toContain('Pirate Hat')
  })

  it('should match each term against a part of a word, which is what makes typing and typos work', () => {
    const { text } = getSearchCteDefinitions('sho')

    expect(text).toContain('t.term <% w.word')
    expect(text).toContain('word_similarity(t.term, w.word)')
    expect(text).not.toContain('search_words.word %')
  })

  it('should keep only the best hit per item and term, so repeating a word cannot inflate the score', () => {
    const { text } = getSearchCteDefinitions('hat')

    expect(text).toMatch(/MAX\(word_similarity\(t\.term, w\.word\)[^)]*\)::float8 AS best/)
    expect(text).toMatch(/GROUP BY w\.item_id, t\.term/)
  })

  it("should read this release's own words table, not the previous release's", () => {
    const { text } = getSearchCteDefinitions('hat')

    expect(text).toContain('FROM marketplace.item_search_words_v3 AS w')
    expect(text).not.toContain('item_search_words_v2')
  })

  it("should count a creator's name only when the term is most of it, never when the name merely contains or starts with it", () => {
    const { text } = getSearchCteDefinitions('duck')

    expect(text).toContain("AND (w.source <> 'creator' OR similarity(t.term, w.word) >= 0.5)")
  })

  it("should weigh a word from the creator's name below the item's own and above the collection's", () => {
    const { text } = getSearchCteDefinitions('mvfw')

    expect(text).toContain("CASE w.source WHEN 'name' THEN 1.0 WHEN 'creator' THEN 0.8 WHEN 'collection' THEN 0.7 ELSE 0 END")
  })

  it('should fold word hits and tag hits into one row per item', () => {
    const { text } = getSearchCteDefinitions('balenciaga')

    expect(text).toContain('search_item_hits AS (')
    expect(text).toMatch(/SELECT hits\.item_id, MAX\(hits\.matched\)::int AS matched, SUM\(hits\.score\)::float8 AS score/)
    expect(text).toMatch(/GROUP BY hits\.item_id\s*\), search_matches AS \(/)
    expect(text).toMatch(/FROM search_item_hits AS h\s+CROSS JOIN search_query AS q/)
  })

  it('should count a tag equal to the whole query as matching every term', () => {
    const { text, values } = getSearchCteDefinitions(' Fashion Week ')

    expect(text).toContain('marketplace.mv_builder_server_items AS tags')
    expect(text).toContain('(SELECT COUNT(*) FROM search_terms)::int AS matched')
    expect(text).toContain('lower(tags.tag) = lower(')
    // trimmed for the exact tag comparison, untouched for the normalizer (which trims on its own)
    expect(values).toEqual([' Fashion Week ', ' Fashion Week ', ' Fashion Week ', 'Fashion Week'])
  })

  it('should omit the leading WITH, so a statement that already opens one can append these', () => {
    const { text } = getSearchCteDefinitions('hat')

    expect(text.trimStart().startsWith('search_terms AS (')).toBe(true)
  })

  it('should bind the query rather than inline it', () => {
    const { text, values } = getSearchCteDefinitions("o'brien")

    expect(text).not.toContain("o'brien")
    expect(values).toEqual(["o'brien", "o'brien", "o'brien", "o'brien"])
  })
})

describe('when joining the matches to a feed', () => {
  it('should LEFT JOIN on the caller-supplied item id, so rows without an item are not dropped by the join', () => {
    const { text } = getSearchMatchJoin('COALESCE(item_p.id, item_s.id)::text')

    expect(text).toContain('LEFT JOIN search_matches AS search_match ON search_match.item_id = COALESCE(item_p.id, item_s.id)::text')
  })
})

describe('when building the search match predicate', () => {
  it('should accept an item whose id the CTE holds, as a hashed IN that runs before the score join', () => {
    const { text, values } = getSearchMatchWhere('item.id::text', 'hat')

    expect(text).toBe('(item.id::text IN (SELECT item_id FROM search_matches))')
    expect(values).toEqual([])
  })

  it('should not depend on word order: the terms are matched one by one in the CTE', () => {
    const a = getSearchCteDefinitions('hat pirate')
    const b = getSearchCteDefinitions('pirate hat')

    expect(a.text).toEqual(b.text)
  })

  describe('and the row is not a collection item at all', () => {
    /**
     * LAND, estates and names live in the nft table, not the item table, so both sides of the caller's
     * COALESCE are NULL and the join finds nothing. Without a fallback a search silently excludes every
     * one of them.
     */
    it('should fall back to the asset name so those rows can still match', () => {
      const { text, values } = getSearchMatchWhere('COALESCE(item_p.id, item_s.id)::text', 'genesis', {
        nonItemNameExpression: 'nft.name'
      })

      expect(text).toContain('OR (COALESCE(item_p.id, item_s.id)::text IS NULL AND nft.name ILIKE')
      expect(values).toEqual(['%genesis%'])
    })

    it('should escape LIKE metacharacters in the fallback, so a term cannot become a wildcard', () => {
      const { values } = getSearchMatchWhere('x', '50%_off', { nonItemNameExpression: 'nft.name' })

      expect(values).toEqual(['%50\\%\\_off%'])
    })

    it('should omit the fallback entirely for callers whose item id is never null', () => {
      const { text } = getSearchMatchWhere('item.id::text', 'genesis')

      expect(text).not.toContain('ILIKE')
      expect(text).not.toContain('IS NULL')
    })
  })
})

describe('when selecting the search columns', () => {
  it('should expose how many terms matched and the score, both computed once per item in the CTE', () => {
    const { text, values } = getSearchScoreColumns()

    expect(text).toBe('search_match.matched AS search_matched, search_match.score AS search_score')
    expect(values).toEqual([])
  })
})

describe('when scoring the matches', () => {
  it('should reward a name that is the query, in any word order, above one that starts with it, through the precomputed name forms', () => {
    const { text, values } = getSearchCteDefinitions('Hat')

    expect(text).toContain('LEFT JOIN marketplace.item_search_names AS n ON n.item_id = h.item_id')
    expect(text).toContain('WHEN n.sorted_words = q.sorted_words THEN 1')
    expect(text).toContain("WHEN n.phrase LIKE q.phrase || ' %' THEN 0.5")
    expect(text).toContain(
      "(SELECT string_agg(word, ' ' ORDER BY word) FROM unnest(marketplace.search_tokens($3)) AS word) AS sorted_words"
    )
    // terms, the phrase, the sorted words and the tag comparison: four bindings of the one query
    expect(values).toEqual(['Hat', 'Hat', 'Hat', 'Hat'])
  })

  it('should weigh each term by how rare it is among the hits, so a relaxed query lists its rare word first', () => {
    const { text } = getSearchCteDefinitions('fisherman hat')

    expect(text).toContain('search_term_weights AS (')
    expect(text).toContain('(1.0 / ln(1.0 + COUNT(*)))::float8 AS weight')
    expect(text).toContain('SUM(h.best * tw.weight)::float8 AS score')
  })
})

describe('when applying the search level', () => {
  it('should keep the rows that matched the most terms among the FILTERED rows, counting above that filter', () => {
    const { text } = applySearchLevel(SQL`SELECT 1 AS search_matched WHERE ${'x'} = 'x'`, 'total')

    expect(text).toContain('MAX(c.search_matched) OVER () AS search_required')
    expect(text).toContain('WHERE f.search_matched IS NULL OR f.search_matched >= f.search_required')
    // the count sits outside the level filter, so it counts what the page shows
    expect(text.indexOf('COUNT(*) OVER () AS total')).toBeLessThan(text.indexOf('search_required'))
    expect(text).toContain("WHERE $1 = 'x'")
  })

  it('should name the count as the caller asks, since /v3/catalog/items calls it count and the rest total', () => {
    expect(applySearchLevel(SQL`SELECT 1`, 'count').text).toContain('COUNT(*) OVER () AS count')
  })
})

describe('when ordering by relevance', () => {
  it('should rank by terms matched, then score, then the caller tiebreak, sending non-item rows last', () => {
    const { text } = getRelevanceOrderBy('f', 'f.created_at DESC, f.trade_id')

    expect(text).toBe(' ORDER BY f.search_matched DESC NULLS LAST, f.search_score DESC NULLS LAST, f.created_at DESC, f.trade_id')
  })
})

describe('when resolving the sort a feed applies', () => {
  it('should default a search to relevance', () => {
    expect(resolveShopSortBy(undefined, 'hat')).toBe('relevance')
  })

  it('should keep an explicit sort on a search', () => {
    expect(resolveShopSortBy('cheapest', 'hat')).toBe('cheapest')
  })

  it('should turn relevance into newest when there is nothing to be relevant to', () => {
    expect(resolveShopSortBy('relevance', undefined)).toBe('newest')
    expect(resolveShopSortBy('relevance', '')).toBe('newest')
  })

  it('should leave the other sorts alone without a search, defaulting to newest', () => {
    expect(resolveShopSortBy('name', undefined)).toBe('name')
    expect(resolveShopSortBy(undefined, undefined)).toBe('newest')
  })
})
