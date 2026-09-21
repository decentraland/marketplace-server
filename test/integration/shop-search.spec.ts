import SQL from 'sql-template-strings'
import { createCreatorProfilesComponent } from '../../src/ports/creator-profiles/component'
import { test } from '../components'
import { createEstateNFT } from './utils/dbItems'
import {
  clearBuilderTags,
  clearCreatorProfiles,
  createSearchableName,
  createSearchableWearable,
  CreateSearchableWearableOptions,
  createSearchNativeTrade,
  deleteSearchableCollection,
  deleteSearchableName,
  deleteSearchableWearable,
  deleteSearchTrade,
  rebuildSearchWords,
  setBuilderTags,
  setCreatorProfile
} from './utils/dbSearch'

const CONTRACT = '0x5ea4c4e5f0a7b2f2e5d1c2b3a4f5e6d7c8b9a0f1'
const HAT_CLUB = '0x6fb5d5f6a1b8c3a3f6e2d3c4b5a6f7e8d9c0b1a2'
const LAND = '0x7ac6e6a7b2c9d4b4a7f3e4d5c6b7a8f9e0d1c2b3'
const ESTATE_TOKEN = '77'
// Creators. GALAXY has a profile and two NAMEs; NAMELESS has no Catalyst profile, only a NAME; CREW is a
// bigger creator with a similar profile name, for the ranking between creators.
const GALAXY = '0x8bd7f7b8c3d0e1a2b3c4d5e6f7a8b9c0d1e2f3a4'
const NAMELESS = '0x9ce8a8c9d4e1f2b3c4d5e6f7a8b9c0d1e2f3a4b5'
const CREW = '0xadf9b9dae5f203c4d5e6f7a8b9c0d1e2f3a4b5c6'
// FANS has GALAXY's NAME as part of a longer profile name; the TWINs share one profile name.
const FANS = '0xbe0acaebf6a314d5e6f7a8b9c0d1e2f3a4b5c6d7'
const TWIN_A = '0xcf1bdbfc07b425e6f7a8b9c0d1e2f3a4b5c6d7e8'
const TWIN_B = '0xd02cec0d18c536f7a8b9c0d1e2f3a4b5c6d7e8f9'

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
  { itemId: '913', contractAddress: CONTRACT, name: 'Twin Sock B', category: 'feet', createdAt: 1999999 },
  // Two items by GALAXY, one by NAMELESS, and an item NAMED after GALAXY's profile by someone else.
  { itemId: '914', contractAddress: CONTRACT, name: 'Nebula Cape', category: 'upper_body', creator: GALAXY },
  { itemId: '915', contractAddress: CONTRACT, name: 'Comet Boots', category: 'feet', creator: GALAXY },
  { itemId: '916', contractAddress: CONTRACT, name: 'Plain Tee', category: 'upper_body', creator: NAMELESS },
  { itemId: '917', contractAddress: CONTRACT, name: 'Galaxy Visor', category: 'eyewear' }
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
    await setCreatorProfile(components, {
      address: GALAXY,
      name: 'Galaxy Studio',
      names: ['GalaxyOne', 'StarForge'],
      items: 2,
      collections: 1
    })
    await setCreatorProfile(components, { address: NAMELESS, name: null, names: ['Wonderbot'], items: 1, collections: 1 })
    await setCreatorProfile(components, { address: CREW, name: 'Galaxy Crew', items: 5, collections: 3 })
    await setCreatorProfile(components, { address: FANS, name: 'Galaxy One Fans', items: 9, collections: 2 })
    await setCreatorProfile(components, { address: TWIN_A, name: 'Twin Maker', items: 3, collections: 1 })
    await setCreatorProfile(components, { address: TWIN_B, name: 'Twin Maker', items: 7, collections: 2 })
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
    await clearCreatorProfiles(components)
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

  describe('and searching by a creator', () => {
    it('should find an item by the name of the profile that created it', async () => {
      const result = await fetchCatalog('search=galaxystudio')

      expect(result.names.slice().sort()).toEqual(['Comet Boots', 'Nebula Cape'])
      expect(result.total).toEqual(2)
    })

    it('should find an item by a NAME its creator holds, whether or not the profile has a name', async () => {
      expect((await fetchCatalog('search=starforge')).names.slice().sort()).toEqual(['Comet Boots', 'Nebula Cape'])
      expect(await fetchCatalog('search=wonderbot')).toEqual({ names: ['Plain Tee'], total: 1 })
    })

    it('should rank an item that carries the word in its own name above the ones that inherit it from their creator', async () => {
      const result = await fetchCatalog('search=galaxy')

      expect(result.names[0]).toEqual('Galaxy Visor')
      expect(result.names.slice(1).sort()).toEqual(['Comet Boots', 'Nebula Cape'])
      expect(result.total).toEqual(3)
    })

    it('should forgive a typo in the creator name', async () => {
      expect((await fetchCatalog('search=galaxi')).names.slice().sort()).toEqual(['Comet Boots', 'Galaxy Visor', 'Nebula Cape'])
    })
  })

  describe('and suggesting creators', () => {
    type Hit = { address: string; name: string; items: number; collections: number }
    async function fetchCreators(query: string): Promise<{ status: number; data: Hit[] }> {
      const response = await components.localFetch.fetch(`/v3/catalog/creators/search?${query}`)
      const body = (await response.json()) as { data?: (Hit & { face: string | null })[] }
      return {
        status: response.status,
        data: (body.data ?? []).map(({ address, name, items, collections }) => ({ address, name, items, collections }))
      }
    }
    const fans = { address: FANS, name: 'Galaxy One Fans', items: 9, collections: 2 }
    const crew = { address: CREW, name: 'Galaxy Crew', items: 5, collections: 3 }
    const galaxy = { address: GALAXY, name: 'Galaxy Studio', items: 2, collections: 1 }
    const nameless = { address: NAMELESS, name: 'Wonderbot', items: 1, collections: 1 }

    it('should list the creators whose profile name or NAME matches, with their counts, the bigger catalogue first on a tie', async () => {
      expect(await fetchCreators('search=galaxy')).toEqual({ status: 200, data: [fans, crew, galaxy] })
    })

    it('should put the creator whose profile name IS the query first, whatever the sizes', async () => {
      expect((await fetchCreators('search=galaxy%20studio')).data).toEqual([galaxy])
    })

    it('should treat a NAME that IS the query as exact too, above a bigger creator whose name only contains it', async () => {
      const { data } = await fetchCreators('search=galaxyone')

      // GALAXY holds the NAME "GalaxyOne"; FANS only has the words run together; CREW trails on "galaxy" alone.
      expect(data.slice(0, 2)).toEqual([galaxy, fans])
      expect(data.map(hit => hit.address)).toEqual([GALAXY, FANS, CREW])
    })

    it('should order two creators with the same name by their catalogue', async () => {
      expect((await fetchCreators('search=twin%20maker')).data.map(hit => hit.address)).toEqual([TWIN_B, TWIN_A])
    })

    it('should require every term, and show a creator with no profile under their NAME', async () => {
      expect((await fetchCreators('search=galaxy%20crew')).data).toEqual([crew])
      expect((await fetchCreators('search=wonderbot')).data).toEqual([nameless])
    })

    it('should fall back to the creators matching the most terms when none matches them all', async () => {
      expect((await fetchCreators('search=galaxy%20wonderbot&first=10')).data).toEqual([fans, crew, galaxy, nameless])
    })

    it('should cap the page and answer an empty query with nothing', async () => {
      expect((await fetchCreators('search=galaxy&first=1')).data).toHaveLength(1)
      expect(await fetchCreators('search=%20')).toEqual({ status: 200, data: [] })
      expect(await fetchCreators('search=%21%21%21')).toEqual({ status: 200, data: [] })
    })
  })

  describe('and refreshing the creator profiles', () => {
    const lookups: string[][] = []
    let catalyst: (ids: string[]) => unknown

    function creatorProfiles(fetchImpl: (ids: string[]) => unknown) {
      catalyst = fetchImpl
      return createCreatorProfilesComponent({
        config: components.config,
        logs: components.logs,
        dappsDatabase: components.dappsDatabase,
        dappsWriteDatabase: components.dappsWriteDatabase,
        fetch: {
          fetch: async (_url, init) => {
            const ids = (JSON.parse(String(init?.body)) as { ids: string[] }).ids
            lookups.push(ids)
            const answer = catalyst(ids)
            if (answer instanceof Error) throw answer
            return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } })
          }
        }
      })
    }

    async function storedProfiles() {
      const { rows } = await components.dappsDatabase.query<{
        address: string
        name: string | null
        names: string[]
        items: number
        collections: number
        face: string | null
      }>(
        SQL`SELECT address, name, names, items, collections, face FROM marketplace.creator_profiles WHERE address = ANY(${[
          GALAXY,
          NAMELESS,
          CREW
        ]}) ORDER BY address`
      )
      return rows
    }

    const galaxyProfile = {
      timestamp: 1,
      avatars: [
        {
          name: 'Galaxy Studio',
          hasClaimedName: true,
          ethAddress: GALAXY,
          avatar: { snapshots: { face256: 'https://img.example/galaxy.png' } }
        }
      ]
    }

    beforeAll(async () => {
      // NAMEs the way the squid records them; the oldest come first in the profile.
      await createSearchableName(components, { tokenId: '5001', owner: GALAXY, name: 'StarForge', createdAt: 1500000 })
      await createSearchableName(components, { tokenId: '5002', owner: GALAXY, name: 'GalaxyOne', createdAt: 1400000 })
      await createSearchableName(components, { tokenId: '5003', owner: NAMELESS, name: 'Wonderbot' })
    })

    afterAll(async () => {
      for (const tokenId of ['5001', '5002', '5003']) await deleteSearchableName(components, tokenId)
    })

    it('should write every creator of an approved collection with their profile, their NAMEs oldest first and their item count, and drop the rest', async () => {
      const component = await creatorProfiles(ids => (ids.includes(GALAXY) ? [galaxyProfile] : []))

      const result = await component.refresh()

      expect(result.outcome).toEqual('refreshed')
      expect(lookups.flat()).toEqual(expect.arrayContaining([GALAXY, NAMELESS, CONTRACT]))
      const rows = await storedProfiles()
      expect(rows).toEqual([
        {
          address: GALAXY,
          name: 'Galaxy Studio',
          names: ['GalaxyOne', 'StarForge'],
          items: 2,
          collections: 1,
          face: 'https://img.example/galaxy.png'
        },
        { address: NAMELESS, name: null, names: ['Wonderbot'], items: 1, collections: 1, face: null }
      ])
      // CREW has published nothing, so it is no longer a creator the search should know.
      expect(rows.some(row => row.address === CREW)).toBe(false)
    })

    it('should keep the names it has when Catalyst cannot be reached, and still refresh the rest', async () => {
      const component = await creatorProfiles(() => new Error('Catalyst is down'))
      await createSearchableName(components, { tokenId: '5004', owner: NAMELESS, name: 'Wonderbot2', createdAt: 1700000 })

      const result = await component.refresh()

      expect(result).toEqual(expect.objectContaining({ outcome: 'refreshed', lookedUp: 0 }))
      expect((result as { failedBatches: number }).failedBatches).toBeGreaterThan(0)
      const rows = await storedProfiles()
      expect(rows.find(row => row.address === GALAXY)?.name).toEqual('Galaxy Studio')
      expect(rows.find(row => row.address === NAMELESS)?.names).toEqual(['Wonderbot', 'Wonderbot2'])
      await deleteSearchableName(components, '5004')
    })

    it('should blank a name Catalyst no longer knows, once it has answered', async () => {
      const component = await creatorProfiles(() => [])

      await component.refresh()

      expect((await storedProfiles()).find(row => row.address === GALAXY)?.name).toBeNull()
    })
  })

  describe('and searching names through /v1/nfts', () => {
    const FAN_TOKENS = Array.from({ length: 24 }, (_, i) => String(6001 + i))
    const TIGER_TOKEN = '6100'

    async function fetchNames(query: string): Promise<{ names: string[]; total: number }> {
      const response = await components.localFetch.fetch(`/v1/nfts?category=ens&${query}`)
      expect(response.status).toEqual(200)
      const body = (await response.json()) as { data: { nft: { name: string } }[]; total: number }
      return { names: body.data.map(row => row.nft.name), total: body.total }
    }

    beforeAll(async () => {
      // Twenty-four names a trigram search for "metatiger" also matches, all newer than the exact one, so a
      // scan in any natural order fills a page of twenty before it reaches METATIGER.
      for (const [i, tokenId] of FAN_TOKENS.entries()) {
        await createSearchableName(components, {
          tokenId,
          owner: CREW,
          name: `MetaTigerFan${String(i + 1).padStart(2, '0')}`,
          createdAt: 2000000 + i
        })
      }
      await createSearchableName(components, { tokenId: TIGER_TOKEN, owner: GALAXY, name: 'METATIGER', createdAt: 1000000 })
    })

    afterAll(async () => {
      for (const tokenId of [...FAN_TOKENS, TIGER_TOKEN]) await deleteSearchableName(components, tokenId)
    })

    it('should put the name that matches best first when no sort is asked for, however many partial matches precede it', async () => {
      const { names, total } = await fetchNames('search=metatiger&first=20')

      expect(names[0]).toEqual('METATIGER')
      expect(names).toHaveLength(20)
      expect(total).toEqual(25)
    })

    it('should forgive a typo', async () => {
      expect((await fetchNames('search=metatinger&first=5')).names[0]).toEqual('METATIGER')
    })

    it('should hand out each name once across consecutive pages', async () => {
      const first = await fetchNames('search=metatiger&first=10&skip=0')
      const second = await fetchNames('search=metatiger&first=10&skip=10')

      expect(new Set([...first.names, ...second.names]).size).toEqual(20)
    })

    it('should keep an explicit sort', async () => {
      const { names } = await fetchNames('search=metatiger&sortBy=newest&first=5')

      expect(names[0]).toEqual('MetaTigerFan24')
      expect(names).not.toContain('METATIGER')
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
