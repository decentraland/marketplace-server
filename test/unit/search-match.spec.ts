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
