import {
  getCollectionSearchQuery,
  SELECT_COLLECTION_SEARCH_NAMES,
  SELECT_SEARCHABLE_COLLECTIONS
} from '../../src/logic/catalog/collection-search'

describe('when building the collection search query', () => {
  it('should match every term against the collection words under the trigram index, by containment, keeping the best hit per term', () => {
    const { text, values } = getCollectionSearchQuery('coca cola', 4)

    expect(text).toContain('FROM marketplace.collection_search_words AS w')
    expect(text).toContain('JOIN search_terms AS t ON t.term <% w.word')
    // a collection's name describes the collection: no similarity gate, unlike a creator's NAME
    expect(text).not.toContain('similarity(t.term, w.word) >=')
    expect(text).toMatch(/MAX\(word_similarity\(t\.term, w\.word\)\)::float8 AS best/)
    expect(text).toContain('GROUP BY w.collection_id, t.term')
    expect(values).toEqual(['coca cola', 'coca cola', 'coca cola', 4])
  })

  it('should fall back to the collections matching the most terms only when none matches them all', () => {
    const { text } = getCollectionSearchQuery('coca zzz', 4)

    expect(text).toContain('WHERE h.matched = (SELECT MAX(matched) FROM search_hits)')
  })

  it('should rank by an explicit tier — exact, prefix, the rest — then score, then items, sales, name and id', () => {
    const { text } = getCollectionSearchQuery('rtfkt', 4)

    expect(text).toMatch(
      /n\.sorted_words = q\.sorted_words THEN 2\s+WHEN starts_with\(n\.phrase, q\.phrase\) THEN 1\s+ELSE 0\s+END AS tier/
    )
    expect(text).toContain('JOIN marketplace.collection_search_names AS n ON n.collection_id = h.collection_id')
    // the tier is its own column: a bonus added to a sum of similarities would not hold for every multi-term query
    expect(text).toContain('ORDER BY tier DESC, h.score DESC, n.items DESC, n.sales DESC, c.name ASC, c.id ASC')
  })
})

describe('when building the collection search tables', () => {
  it('should index only approved collections that have an approved item', () => {
    expect(SELECT_SEARCHABLE_COLLECTIONS).toContain('c.is_approved = true')
    expect(SELECT_SEARCHABLE_COLLECTIONS).toContain('i.search_is_collection_approved = true')
  })

  it("should count each collection's approved items and its sales over the window, attributed through the item", () => {
    expect(SELECT_COLLECTION_SEARCH_NAMES).toContain('COUNT(*)::int AS items')
    expect(SELECT_COLLECTION_SEARCH_NAMES).toContain('JOIN squid_marketplace.item AS i ON i.id = s.item_id')
    expect(SELECT_COLLECTION_SEARCH_NAMES).toContain("s.timestamp > EXTRACT(EPOCH FROM now() - interval '90 days')")
    expect(SELECT_COLLECTION_SEARCH_NAMES).toContain('COALESCE(sold.sales, 0) AS sales')
  })
})
