import { getSearchMatchWhere } from '../../src/logic/catalog/search-match'

describe('when building the search match predicate', () => {
  describe('and given a single-word term', () => {
    it('should match the pre-split word table rather than a substring of the whole name', () => {
      const { text } = getSearchMatchWhere('item.id::text', 'hat')

      expect(text).toContain('marketplace.item_search_words')
      expect(text).toContain('search_words.word % lower(')
      expect(text).not.toContain('ILIKE')
    })

    it('should also match the item tags, where creators put brand and collab names', () => {
      const { text } = getSearchMatchWhere('item.id::text', 'hat')

      expect(text).toContain('marketplace.mv_builder_server_items')
      expect(text).toContain('lower(search_tags.tag) = lower(')
    })

    it('should look both up by the caller-supplied item id, so the lookup stays indexed', () => {
      const { text } = getSearchMatchWhere('COALESCE(item_p.id, item_s.id)::text', 'hat')

      expect(text).toContain('search_words.item_id = COALESCE(item_p.id, item_s.id)::text')
      expect(text).toContain('search_tags.item_id = COALESCE(item_p.id, item_s.id)::text')
    })

    it('should bind the term instead of inlining it', () => {
      const query = getSearchMatchWhere('item.id::text', "o'brien")

      expect(query.text).not.toContain("o'brien")
      expect(query.values).toEqual(["o'brien", "o'brien"])
    })
  })

  describe('and given a term whose words are not adjacent in any name', () => {
    it('should not depend on word order, which is what the substring form could never do', () => {
      // Both directions produce the same shape; the matching itself happens per word in the table, so
      // "hat pirate" and "pirate hat" reach the same rows. The old ILIKE returned nothing for the first.
      const a = getSearchMatchWhere('item.id::text', 'hat pirate')
      const b = getSearchMatchWhere('item.id::text', 'pirate hat')

      expect(a.text).toEqual(b.text)
      expect(a.text).not.toContain('%hat pirate%')
    })
  })

  describe('and given a term containing LIKE metacharacters', () => {
    it('should carry them as data, since nothing is interpolated into a LIKE pattern any more', () => {
      const query = getSearchMatchWhere('item.id::text', '100%_off')

      expect(query.values).toEqual(['100%_off', '100%_off'])
      expect(query.text).not.toContain('100%_off')
    })
  })
})

describe('when the row is not a collection item at all', () => {
  /**
   * LAND, estates and names live in the nft table, not the item table, so both sides of the caller's
   * COALESCE are NULL — and `NULL = anything` is never true. Without a fallback a search silently
   * excludes every one of them, which is what the word-table match on its own did.
   */
  it('should fall back to the asset name so those rows can still match', () => {
    const { text, values } = getSearchMatchWhere('COALESCE(item_p.id, item_s.id)::text', 'genesis', {
      nonItemNameExpression: 'nft.name'
    })

    expect(text).toContain('COALESCE(item_p.id, item_s.id)::text IS NULL AND nft.name ILIKE')
    expect(values).toContain('%genesis%')
  })

  it('should only reach the fallback when there is no item, leaving the indexed path in charge otherwise', () => {
    const { text } = getSearchMatchWhere('COALESCE(item_p.id, item_s.id)::text', 'genesis', {
      nonItemNameExpression: 'nft.name'
    })

    // the fallback is guarded by IS NULL, so an item row is never matched by a loose substring
    expect(text).toMatch(/OR \(COALESCE\(item_p\.id, item_s\.id\)::text IS NULL AND/)
  })

  it('should escape LIKE metacharacters in the fallback, so a term cannot become a wildcard', () => {
    const { values } = getSearchMatchWhere('x', '50%_off', { nonItemNameExpression: 'nft.name' })

    expect(values).toContain('%50\\%\\_off%')
  })

  it('should omit the fallback entirely for callers whose item id is never null', () => {
    const { text } = getSearchMatchWhere('item.id::text', 'genesis')

    expect(text).not.toContain('ILIKE')
    expect(text).not.toContain('IS NULL')
  })
})
