import SQL from 'sql-template-strings'
import { test } from '../components'
import { createEstateNFT } from './utils/dbItems'
import {
  clearBuilderTags,
  createSearchableWearable,
  CreateSearchableWearableOptions,
  createSearchNativeTrade,
  deleteSearchableCollection,
  deleteSearchableWearable,
  deleteSearchTrade,
  rebuildSearchWords,
  setBuilderTags
} from './utils/dbSearch'

const CONTRACT = '0x5ea4c4e5f0a7b2f2e5d1c2b3a4f5e6d7c8b9a0f1'
const HAT_CLUB = '0x6fb5d5f6a1b8c3a3f6e2d3c4b5a6f7e8d9c0b1a2'
const LAND = '0x7ac6e6a7b2c9d4b4a7f3e4d5c6b7a8f9e0d1c2b3'
const ESTATE_TOKEN = '77'

// Every fixture is a wearable in the catalogue: a name, a category, and whether it is on sale.
const FIXTURES: CreateSearchableWearableOptions[] = [
  { itemId: '901', contractAddress: CONTRACT, name: 'Pirate Hat', category: 'hat' },
  { itemId: '902', contractAddress: CONTRACT, name: 'Hat', category: 'hat' },
  { itemId: '903', contractAddress: CONTRACT, name: 'Pirate Flag', category: 'upper_body' },
  { itemId: '904', contractAddress: CONTRACT, name: 'Shoes of Doom', category: 'feet' },
  { itemId: '905', contractAddress: CONTRACT, name: 'Máscara Épica', category: 'mask' },
  { itemId: '906', contractAddress: CONTRACT, name: 'T-Shirt', category: 'upper_body' },
  { itemId: '907', contractAddress: CONTRACT, name: 'Tshirt', category: 'upper_body' },
  { itemId: '908', contractAddress: CONTRACT, name: 'T Shirt', category: 'upper_body' },
  { itemId: '909', contractAddress: HAT_CLUB, name: 'Beanie', collectionName: 'Hat Club', category: 'hat' },
  { itemId: '910', contractAddress: CONTRACT, name: 'Golf Craft Shoes', category: 'feet' },
  // Two items that tie on every sort key but their id, for the paging cases.
  { itemId: '912', contractAddress: CONTRACT, name: 'Twin Sock A', category: 'feet', createdAt: 1999999 },
  { itemId: '913', contractAddress: CONTRACT, name: 'Twin Sock B', category: 'feet', createdAt: 1999999 }
]

test('when searching the catalogue', function ({ components }) {
  async function fetchCatalog(query: string): Promise<{ names: string[]; total: number }> {
    const response = await components.localFetch.fetch(`/v3/catalog/items?${query}`)
    expect(response.status).toEqual(200)
    const body = (await response.json()) as { data: { name: string }[]; total: number }
    return { names: body.data.map(item => item.name), total: body.total }
  }

  async function fetchUnified(query: string): Promise<{ names: string[]; total: number }> {
    const response = await components.localFetch.fetch(`/v3/catalog/unified?${query}`)
    expect(response.status).toEqual(200)
    const body = (await response.json()) as { data: { name: string }[]; total: number }
    return { names: body.data.map(row => row.name), total: body.total }
  }

  let tagIds: { collectionId: string; itemId: string }
  let itemTradeId: string
  let estateTradeId: string

  beforeAll(async () => {
    for (const fixture of FIXTURES) await createSearchableWearable(components, fixture)
    // The beanie is also TAGGED with a phrase: the tag path and the word path must fold into one row.
    tagIds = await setBuilderTags(components, { contractAddress: HAT_CLUB, itemId: '909', tags: ['Hat Club Merch'] })
    await rebuildSearchWords(components)
    // The unified feed lists open trades: the pirate hat as a native primary listing, and an ESTATE — a
    // row that is not a collection item, which the search reaches through its substring fallback on the
    // asset's own name (names, LAND and estates all go through it).
    itemTradeId = await createSearchNativeTrade(components, { contractAddress: CONTRACT, itemId: '901' })
    await createEstateNFT(components, LAND, ESTATE_TOKEN, { name: 'Pirate Hat Plaza' })
    estateTradeId = await createSearchNativeTrade(components, { contractAddress: LAND, tokenId: ESTATE_TOKEN })
  })

  afterAll(async () => {
    await deleteSearchTrade(components, itemTradeId)
    await deleteSearchTrade(components, estateTradeId)
    await components.dappsDatabase.query(`DELETE FROM squid_marketplace."nft" WHERE id = 'estate-${LAND}-${ESTATE_TOKEN}'`)
    await clearBuilderTags(components, tagIds)
    for (const fixture of FIXTURES) await deleteSearchableWearable(components, fixture.itemId, fixture.contractAddress)
    await deleteSearchableCollection(components, CONTRACT)
    await deleteSearchableCollection(components, HAT_CLUB)
    await rebuildSearchWords(components)
  })

  describe('and normalizing text', () => {
    it('should lowercase, strip accents and punctuation, expand ligatures and drop symbols, on both sides of the match', async () => {
      const { rows } = await components.dappsDatabase.query<{ tokens: string[]; phrase: string; terms: string[] }>(
        SQL`SELECT
              marketplace.search_tokens(${'Máscara Épica Æther Straße ½ Mask 🔥 Hot T-Shirt (Ice 100%_off'}) AS tokens,
              marketplace.search_phrase(${'The World Is Yours!'}) AS phrase,
              marketplace.search_query_terms(${'the world is yours'}) AS terms`
      )

      expect(rows[0].tokens).toEqual(['mascara', 'epica', 'aether', 'strasse', 'mask', 'hot', 't', 'shirt', 'ice', '100', 'off'])
      expect(rows[0].phrase).toEqual('the world is yours')
      // the phrase keeps "the"; the terms drop it
      expect(rows[0].terms).toEqual(['world', 'is', 'yours'])
    })

    it('should keep a stopword that is the whole query, dedupe terms, cap them and collapse a punctuated word', async () => {
      const { rows } = await components.dappsDatabase.query<{
        x: string[]
        dup: string[]
        capped: string[]
        empty: string[]
        collapsed: string[]
      }>(
        SQL`SELECT
              marketplace.search_query_terms(${'x'}) AS x,
              marketplace.search_query_terms(${'Atari x RTFKT x Atari'}) AS dup,
              marketplace.search_query_terms(${'a b c d e f g h'}) AS capped,
              marketplace.search_query_terms(${'!!!'}) AS empty,
              marketplace.search_query_terms(${"T-Shirt o'brien golfcraft - space"}) AS collapsed`
      )

      expect(rows[0].x).toEqual(['x'])
      expect(rows[0].dup).toEqual(['atari', 'rtfkt'])
      expect(rows[0].capped).toEqual(['b', 'c', 'd', 'e', 'f', 'g'])
      expect(rows[0].empty).toEqual([])
      expect(rows[0].collapsed).toEqual(['tshirt', 'obrien', 'golfcraft', 'space'])
    })

    it('should clean symbols the same way on the query side as on the index side', async () => {
      // unaccent expands '½' to ' 1/2' and '©' to '(C)': cleaned after the expansion, a query carried
      // terms no stored word can match — and a name that IS the query lost the exact match to a rival.
      const { rows } = await components.dappsDatabase.query<{ indexed: string[]; queried: string[] }>(
        SQL`SELECT marketplace.search_tokens(${'½ Mask © Club'}) AS indexed, marketplace.search_query_terms(${'½ Mask © Club'}) AS queried`
      )

      expect(rows[0].indexed).toEqual(['mask', 'club'])
      expect(rows[0].queried).toEqual(['mask', 'club'])
    })

    it('should treat a decomposed accent as the precomposed letter, on every side', async () => {
      const decomposed = 'Ma\u0301scara'
      const { rows } = await components.dappsDatabase.query<{ tokens: string[]; terms: string[]; same: boolean }>(
        SQL`SELECT
              marketplace.search_tokens(${decomposed}) AS tokens,
              marketplace.search_query_terms(${decomposed}) AS terms,
              marketplace.search_phrase(${decomposed}) = marketplace.search_phrase(${'Máscara'}) AS same`
      )

      expect(rows[0].tokens).toEqual(['mascara'])
      expect(rows[0].terms).toEqual(['mascara'])
      expect(rows[0].same).toBe(true)
    })
  })

  describe('and every term matches an item', () => {
    it('should return only the items that match every term, whatever the order of the words', async () => {
      expect(await fetchCatalog('search=pirate%20hat')).toEqual({ names: ['Pirate Hat'], total: 1 })
      expect(await fetchCatalog('search=hat%20pirate')).toEqual({ names: ['Pirate Hat'], total: 1 })
    })
  })

  describe('and no item matches every term', () => {
    it('should relax to the items that match the most terms, ranked by how well they match', async () => {
      // "fisherman" matches nothing; "hat" reaches three items: the exact name first, then the name that
      // carries the word, then the one that only inherits it from its collection
      expect(await fetchCatalog('search=fisherman%20hat')).toEqual({ names: ['Hat', 'Pirate Hat', 'Beanie'], total: 3 })
    })
  })

  describe('and the only full match is excluded by the surface filters', () => {
    it('should relax among the rows the filter keeps, and count those', async () => {
      // the pirate hat is a hat; asked for upper-body items, the flag is what "pirate hat" can still mean
      expect(await fetchCatalog('search=pirate%20hat&wearableCategory=upper_body')).toEqual({ names: ['Pirate Flag'], total: 1 })
    })

    describe('and the excluded match is one that is not on sale', () => {
      beforeAll(async () => {
        await createSearchableWearable(components, { ...FIXTURES[0], isStoreMinterSet: false, available: 0 })
      })

      afterAll(async () => {
        await createSearchableWearable(components, FIXTURES[0])
      })

      it('should still find it in the whole catalogue', async () => {
        expect(await fetchCatalog('search=pirate%20hat')).toEqual({ names: ['Pirate Hat'], total: 1 })
      })

      it('should relax to the partial matches that ARE on sale, rather than answer with nothing', async () => {
        const result = await fetchCatalog('search=pirate%20hat&isOnSale=true')

        expect(result.names).not.toContain('Pirate Hat')
        // the flag and the hat each match one term with the same score; the newer item breaks the tie
        expect(result.names).toEqual(['Pirate Flag', 'Hat', 'Beanie'])
        expect(result.total).toEqual(3)
      })
    })
  })

  describe('and typing the first letters of a word', () => {
    it('should match the words that start with them', async () => {
      const { names } = await fetchCatalog('search=sh')

      expect(names).toEqual(expect.arrayContaining(['Shoes of Doom', 'Golf Craft Shoes', 'T-Shirt', 'T Shirt']))
      expect(names).not.toContain('Pirate Hat')
    })
  })

  describe('and the query or the name carries accents or capitals', () => {
    it('should match regardless', async () => {
      expect(await fetchCatalog('search=mascara')).toEqual({ names: ['Máscara Épica'], total: 1 })
      expect(await fetchCatalog('search=M%C3%81SCARA%20%C3%A9pica')).toEqual({ names: ['Máscara Épica'], total: 1 })
    })
  })

  describe('and a name or the query is hyphenated', () => {
    it('should find the hyphenated, joined and spaced spellings from the hyphenated and joined queries', async () => {
      for (const query of ['t-shirt', 'tshirt']) {
        const { names, total } = await fetchCatalog(`search=${query}`)
        expect(names.sort()).toEqual(['T Shirt', 'T-Shirt', 'Tshirt'])
        expect(total).toEqual(3)
      }
    })

    it('should find the hyphenated and spaced spellings from the spaced query, but not the joined one', async () => {
      // Known gap: "t shirt" is two terms and neither is similar enough to the single word "tshirt".
      const { names, total } = await fetchCatalog('search=t%20shirt')
      expect(names.sort()).toEqual(['T Shirt', 'T-Shirt'])
      expect(total).toEqual(2)
    })

    it('should find a two-word name from its words run together', async () => {
      expect(await fetchCatalog('search=golfcraft')).toEqual({ names: ['Golf Craft Shoes'], total: 1 })
    })
  })

  describe('and a term is in the collection name rather than the item name', () => {
    it('should find the item through its collection, once, and count it once', async () => {
      expect(await fetchCatalog('search=club')).toEqual({ names: ['Beanie'], total: 1 })

      const { names, total } = await fetchCatalog('search=hat')
      expect(names.filter(name => name === 'Beanie')).toHaveLength(1)
      expect(total).toEqual(names.length)
    })
  })

  describe('and the query carries a stopword', () => {
    it('should search for the rest of it', async () => {
      const withStopword = await fetchCatalog('search=the%20hat')
      const without = await fetchCatalog('search=hat')

      // Same rows, same count. The order may differ: the exact-name bonus compares the whole phrase, and
      // "the hat" is not the name "Hat".
      expect(withStopword.names.sort()).toEqual(without.names.sort())
      expect(withStopword.total).toEqual(without.total)
    })
  })

  describe('and a sort is chosen', () => {
    it('should apply it to the matching rows instead of the relevance ranking', async () => {
      expect(await fetchCatalog('search=hat&sortBy=name')).toEqual({ names: ['Beanie', 'Hat', 'Pirate Hat'], total: 3 })
    })

    it('should accept relevance without a search and fall back to the default order', async () => {
      const withRelevance = await fetchCatalog(`sortBy=relevance&contractAddress=${CONTRACT}`)
      const byDefault = await fetchCatalog(`contractAddress=${CONTRACT}`)

      expect(withRelevance).toEqual(byDefault)
      expect(withRelevance.total).toEqual(FIXTURES.filter(fixture => fixture.contractAddress === CONTRACT).length)
    })
  })

  describe('and an item matches by its words and by a tag', () => {
    it('should appear once, matched by every term, and be counted once', async () => {
      // "hat" and "club" reach the beanie through its collection's name; the tag "Hat Club Merch" is the
      // whole phrase, so it counts for all three terms — one row, not two.
      expect(await fetchCatalog('search=hat%20club%20merch')).toEqual({ names: ['Beanie'], total: 1 })
    })
  })

  describe('and searching the unified feed, which also lists names, LAND and estates', () => {
    // Every fixture is a CollectionStore mint, so each one is a listing of this feed too; the pirate hat
    // has a native trade on top, which is why the per-listing shape carries it twice.
    it('should rank the matching items first and keep, last, the estate that matches by its own name', async () => {
      const byItem = await fetchUnified('groupBy=item&search=pirate')
      expect(byItem.names.slice().sort()).toEqual(['Pirate Flag', 'Pirate Hat', 'Pirate Hat Plaza'])
      expect(byItem.names.at(-1)).toEqual('Pirate Hat Plaza')
      expect(byItem.total).toEqual(3)

      const byListing = await fetchUnified('search=pirate')
      expect(byListing.names.slice().sort()).toEqual(['Pirate Flag', 'Pirate Hat', 'Pirate Hat', 'Pirate Hat Plaza'])
      expect(byListing.names.at(-1)).toEqual('Pirate Hat Plaza')
      expect(byListing.total).toEqual(4)
    })

    it('should keep the estate through the level filter, which only ranks collection items', async () => {
      // "pirate hat" matches every term on the hat alone and drops the flag; the estate has no terms to
      // count — it matched the whole phrase as a substring — and passes the level as is
      expect(await fetchUnified('groupBy=item&search=pirate%20hat')).toEqual({ names: ['Pirate Hat', 'Pirate Hat Plaza'], total: 2 })
    })

    it('should not list the estate when its name says nothing about the query', async () => {
      expect(await fetchUnified('groupBy=item&search=beanie')).toEqual({ names: ['Beanie'], total: 1 })
    })
  })

  describe('and paging through rows that tie on every sort key', () => {
    it('should hand out each row exactly once across consecutive pages', async () => {
      const first = await fetchCatalog('search=twin&first=1&skip=0')
      const second = await fetchCatalog('search=twin&first=1&skip=1')

      expect(first.total).toEqual(2)
      expect(second.total).toEqual(2)
      expect([...first.names, ...second.names].sort()).toEqual(['Twin Sock A', 'Twin Sock B'])
    })
  })

  describe('and searching through /v1/items', () => {
    it('should apply the same matching and ranking', async () => {
      const response = await components.localFetch.fetch('/v1/items?search=fisherman%20hat')
      const body = (await response.json()) as { data: { name: string }[]; total: number }

      expect(response.status).toEqual(200)
      expect(body.data.map(item => item.name)).toEqual(['Hat', 'Pirate Hat', 'Beanie'])
      expect(body.total).toEqual(3)
    })
  })
})
