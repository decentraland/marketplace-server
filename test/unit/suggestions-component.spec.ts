import { createSuggestionsComponent } from '../../src/ports/suggestions/component'
import type { ISuggestionsComponent } from '../../src/ports/suggestions/types'

const ADDRESS = '0x1096f950841a99f9b961434714d9a08d3d4ebdff'
const RATE = 0.02

/** A core row shaped the way buildItemUnifiedCore returns them. */
function candidateRow(index: number, overrides: Record<string, unknown> = {}) {
  return {
    source: 'native',
    acquisition: 'trade',
    trade_id: `trade-${index}`,
    trade_type: 'public_item_order',
    contract_address: `0xc${index}`,
    item_id: String(index),
    token_id: null,
    name: `Item ${index}`,
    image: '',
    rarity: 'epic',
    item_type: 'wearable_v2',
    wearable_category: 'hat',
    emote_loop: null,
    gender: 'unisex',
    creator: '0xcreator',
    seller: null,
    issued_id: null,
    price_credits: '10',
    mana_wei: null,
    available: '1',
    created_at: '1700000000',
    listing_count: '1',
    usd_wei: '1',
    cf: 1,
    content: 0,
    popularity: 0,
    trigger_item_id: '0xaaa-1',
    trigger_source: 'owned',
    ...overrides
  }
}

describe('when asking for suggestions', () => {
  let suggestions: ISuggestionsComponent
  let queryRows: Record<string, unknown>[][]
  let query: jest.Mock
  let getTrendingItems: jest.Mock
  let getPicksByListId: jest.Mock
  let cacheGet: jest.Mock
  let cacheSet: jest.Mock

  beforeEach(async () => {
    queryRows = []
    query = jest.fn(async () => ({ rows: queryRows.shift() ?? [] }))
    getTrendingItems = jest.fn(async () => ({ data: [{ name: 'Trending item', trendingSales: 3 }] }))
    getPicksByListId = jest.fn(async () => [])
    cacheGet = jest.fn(async () => undefined)
    cacheSet = jest.fn(async () => undefined)

    suggestions = await createSuggestionsComponent({
      dappsDatabase: { query },
      shopCatalog: { getTrendingItems },
      lists: { getPicksByListId },
      cache: { get: cacheGet, set: cacheSet },
      config: { getNumber: async () => undefined },
      logs: { getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() }) }
    } as never)
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('and there is neither an address nor seeds', () => {
    let result: Awaited<ReturnType<ISuggestionsComponent['getSuggestions']>>

    beforeEach(async () => {
      result = await suggestions.getSuggestions({}, RATE)
    })

    it('should fall back to the trending rail', () => {
      expect(getTrendingItems).toHaveBeenCalled()
    })

    it('should report the rail as not personalised, so the Shop can hide it', () => {
      expect(result.personalized).toBe(false)
    })

    it('should label every row as trending rather than inventing a personal reason', () => {
      expect(result.data.every(item => item.reason.kind === 'trending')).toBe(true)
    })

    it('should never query for a wallet it does not have', () => {
      expect(query).not.toHaveBeenCalled()
    })
  })

  describe('and there are seeds but no address', () => {
    beforeEach(async () => {
      // profile attributes, then the candidate scores
      queryRows = [[], [{ contract: '0xc0' }], Array.from({ length: 8 }, (_, i) => candidateRow(i))]
      await suggestions.getSuggestions({ seeds: [`${ADDRESS}-1`, `${ADDRESS}-2`] }, RATE)
    })

    it('should personalise from the seeds instead of falling back', () => {
      expect(getTrendingItems).not.toHaveBeenCalled()
    })

    it('should never look up holdings for a wallet it was not given', () => {
      const ownedQueries = query.mock.calls.filter(call => String(call[0].text ?? '').includes('owner_address'))
      expect(ownedQueries).toHaveLength(0)
    })
  })

  describe('and the wallet yields fewer candidates than the personalisation threshold', () => {
    let result: Awaited<ReturnType<ISuggestionsComponent['getSuggestions']>>

    beforeEach(async () => {
      queryRows = [[{ item_id: '0xaaa-1', acquired_at: '1700000000', paid: true }], [], [candidateRow(0), candidateRow(1), candidateRow(2)]]
      result = await suggestions.getSuggestions({ address: ADDRESS }, RATE)
    })

    it('should fall back to trending rather than show a three-row personal rail', () => {
      expect(getTrendingItems).toHaveBeenCalled()
    })

    it('should report the rail as not personalised', () => {
      expect(result.personalized).toBe(false)
    })
  })

  describe('and the wallet yields enough candidates', () => {
    let result: Awaited<ReturnType<ISuggestionsComponent['getSuggestions']>>

    beforeEach(async () => {
      queryRows = [
        [{ item_id: '0xaaa-1', acquired_at: '1700000000', paid: true }],
        [],
        [{ contract: '0xc0' }],
        Array.from({ length: 8 }, (_, i) => candidateRow(i))
      ]
      result = await suggestions.getSuggestions({ address: ADDRESS, first: 6 }, RATE)
    })

    it('should report the rail as personalised', () => {
      expect(result.personalized).toBe(true)
    })

    it('should return no more rows than asked for', () => {
      expect(result.data).toHaveLength(6)
    })

    it('should carry the algorithm version so the A/B can split on it', () => {
      expect(result.algorithm).toBe('v1')
    })

    it('should explain each row by the signal that earned it', () => {
      expect(result.data.every(item => item.reason.kind === 'co_owned')).toBe(true)
    })
  })

  describe('and no collection can supply a candidate', () => {
    let result: Awaited<ReturnType<ISuggestionsComponent['getSuggestions']>>

    beforeEach(async () => {
      queryRows = [[{ item_id: '0xaaa-1', acquired_at: '1700000000', paid: true }], [], []]
      result = await suggestions.getSuggestions({ address: ADDRESS }, RATE)
    })

    it('should fall back to trending instead of running the catalogue query over everything', () => {
      expect(result.personalized).toBe(false)
    })
  })

  describe('and the same request was answered recently', () => {
    let result: Awaited<ReturnType<ISuggestionsComponent['getSuggestions']>>

    beforeEach(async () => {
      cacheGet.mockResolvedValue({ data: [], personalized: true, algorithm: 'v1' })
      result = await suggestions.getSuggestions({ address: ADDRESS }, RATE)
    })

    it('should serve the cached answer', () => {
      expect(result.personalized).toBe(true)
    })

    it('should not touch the database', () => {
      expect(query).not.toHaveBeenCalled()
    })
  })

  describe('and the caller asks about a wallet without proving they are it', () => {
    beforeEach(async () => {
      getPicksByListId.mockResolvedValue([{ item_id: '0xbbb-2' }])
      queryRows = [
        [{ item_id: '0xaaa-1', acquired_at: '1700000000', paid: true }],
        [],
        [{ contract: '0xc0' }],
        Array.from({ length: 8 }, (_, i) => candidateRow(i))
      ]
      await suggestions.getSuggestions({ address: ADDRESS }, RATE)
    })

    it("should not read the favorites, which is what stops one person enumerating another's", () => {
      expect(getPicksByListId).not.toHaveBeenCalled()
    })
  })

  describe('and the caller proved they are the wallet', () => {
    beforeEach(async () => {
      getPicksByListId.mockResolvedValue([{ item_id: '0xbbb-2' }])
      queryRows = [
        [{ item_id: '0xaaa-1', acquired_at: '1700000000', paid: true }],
        [],
        [{ contract: '0xc0' }],
        Array.from({ length: 8 }, (_, i) => candidateRow(i))
      ]
      await suggestions.getSuggestions({ address: ADDRESS, verifiedAddress: ADDRESS }, RATE)
    })

    it('should read their favorites, which is the one thing the signature buys', () => {
      expect(getPicksByListId).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ userAddress: ADDRESS }))
    })
  })

  describe('and the proven identity is a different wallet from the one asked about', () => {
    beforeEach(async () => {
      getPicksByListId.mockResolvedValue([{ item_id: '0xbbb-2' }])
      queryRows = [
        [{ item_id: '0xaaa-1', acquired_at: '1700000000', paid: true }],
        [],
        [{ contract: '0xc0' }],
        Array.from({ length: 8 }, (_, i) => candidateRow(i))
      ]
      await suggestions.getSuggestions({ address: ADDRESS, verifiedAddress: '0x000000000000000000000000000000000000dead' }, RATE)
    })

    it("should read neither wallet's favorites rather than mix two people into one rail", () => {
      expect(getPicksByListId).not.toHaveBeenCalled()
    })
  })

  describe('and the same wallet is asked about signed and unsigned', () => {
    let keys: string[]

    beforeEach(async () => {
      getPicksByListId.mockResolvedValue([{ item_id: '0xbbb-2' }])
      await suggestions.getSuggestions({ address: ADDRESS, verifiedAddress: ADDRESS }, RATE)
      await suggestions.getSuggestions({ address: ADDRESS }, RATE)
      keys = cacheSet.mock.calls.map(call => call[0])
    })

    it("should cache the two apart, so the unsigned caller cannot read the signed one's favorites out of the cache", () => {
      expect(keys[0]).not.toBe(keys[1])
    })
  })

  describe('and the rail falls back with an exclusion in the request', () => {
    let result: Awaited<ReturnType<ISuggestionsComponent['getSuggestions']>>

    beforeEach(async () => {
      getTrendingItems.mockResolvedValue({
        data: [
          { contractAddress: ADDRESS, itemId: '1', gender: 'unisex' },
          { contractAddress: ADDRESS, itemId: '2', gender: 'unisex' }
        ]
      })
      result = await suggestions.getSuggestions({ exclude: [`${ADDRESS}-1`] }, RATE)
    })

    it('should not offer back the item the caller asked it to leave out', () => {
      expect(result.data.map(item => item.itemId)).toEqual(['2'])
    })

    it('should ask for more rows than the rail shows, so the exclusion cannot leave it short', () => {
      expect(getTrendingItems.mock.calls[0][0].first).toBeGreaterThan(result.data.length)
    })
  })

  describe('and the rail falls back for an avatar with a body shape', () => {
    let result: Awaited<ReturnType<ISuggestionsComponent['getSuggestions']>>

    beforeEach(async () => {
      getTrendingItems.mockResolvedValue({
        data: [
          { contractAddress: ADDRESS, itemId: 'emote', gender: null },
          { contractAddress: ADDRESS, itemId: 'unisex', gender: 'unisex' },
          { contractAddress: ADDRESS, itemId: 'female', gender: 'female' },
          { contractAddress: ADDRESS, itemId: 'male', gender: 'male' }
        ]
      })
      result = await suggestions.getSuggestions({ bodyShape: 'BaseFemale' }, RATE)
    })

    it('should drop only the shape this avatar cannot wear', () => {
      expect(result.data.map(item => item.itemId)).toEqual(['emote', 'unisex', 'female'])
    })

    it('should never narrow the catalogue query by wearable body shapes, which would drop every emote', () => {
      expect(getTrendingItems.mock.calls[0][0].wearableGenders).toBeUndefined()
    })
  })

  describe('and the wallet holds a trending item the profile never saw', () => {
    let result: Awaited<ReturnType<ISuggestionsComponent['getSuggestions']>>

    beforeEach(async () => {
      // Nothing bought, so no profile and no personalisation -- but `nft` still says one of these is theirs,
      // which is what a gift, or a holding past the profile's cap, looks like from here.
      queryRows = [[], [{ item_id: `${ADDRESS}-1` }]]
      getTrendingItems.mockResolvedValue({
        data: [
          { contractAddress: ADDRESS, itemId: '1', gender: 'unisex' },
          { contractAddress: ADDRESS, itemId: '2', gender: 'unisex' }
        ]
      })
      result = await suggestions.getSuggestions({ address: ADDRESS }, RATE)
    })

    it('should not offer it back to its own owner', () => {
      expect(result.data.map(item => item.itemId)).toEqual(['2'])
    })

    it('should ask about the candidates on the table rather than load every holding', () => {
      expect(query.mock.calls[1][0].values).toEqual([ADDRESS, [`${ADDRESS}-1`, `${ADDRESS}-2`]])
    })
  })

  describe('and the body shape is not one an avatar can have', () => {
    let keys: string[]

    beforeEach(async () => {
      await suggestions.getSuggestions({ bodyShape: 'BaseAlien' }, RATE)
      await suggestions.getSuggestions({}, RATE)
      await suggestions.getSuggestions({ bodyShape: 'BaseMale' }, RATE)
      keys = cacheSet.mock.calls.map(call => call[0])
    })

    it('should cache it as the unfiltered rail rather than as a key of its own', () => {
      expect(keys[0]).toBe(keys[1])
    })

    it('should still distinguish a shape that does exist, so the key is not simply ignoring it', () => {
      expect(keys[2]).not.toBe(keys[1])
    })

    it('should keep every row, since there is no shape to judge compatibility against', () => {
      expect(getTrendingItems).toHaveBeenCalled()
    })
  })

  describe('and a category is requested', () => {
    beforeEach(async () => {
      queryRows = [[], [{ contract: '0xc0' }], Array.from({ length: 8 }, (_, i) => candidateRow(i))]
      await suggestions.getSuggestions({ seeds: [`${ADDRESS}-1`], category: 'emote' }, RATE)
    })

    it('should cache the answer under a key that distinguishes it from the unfiltered rail', () => {
      expect(cacheSet.mock.calls[0][0]).toContain('emote')
    })
  })

  describe('and the category is not one the rail splits on', () => {
    let keys: string[]

    beforeEach(async () => {
      await suggestions.getSuggestions({ category: 'land' }, RATE)
      await suggestions.getSuggestions({}, RATE)
      keys = cacheSet.mock.calls.map(call => call[0])
    })

    it('should collapse to the unfiltered key, so an endless stream of made-up values cannot miss the cache every time', () => {
      expect(keys[0]).toBe(keys[1])
    })

    it('should not pass it to the catalogue, which would filter on a category that matches nothing', () => {
      expect(getTrendingItems.mock.calls[0][0].category).toBeUndefined()
    })
  })

  describe('and more computations are already in flight than the process allows', () => {
    let results: Awaited<ReturnType<ISuggestionsComponent['getSuggestions']>>[]
    let releaseTrending: () => void
    let warn: jest.Mock

    beforeEach(async () => {
      warn = jest.fn()
      suggestions = await createSuggestionsComponent({
        dappsDatabase: { query },
        shopCatalog: { getTrendingItems },
        cache: { get: cacheGet, set: cacheSet },
        config: { getNumber: async () => 1 },
        logs: { getLogger: () => ({ info: jest.fn(), warn, error: jest.fn(), debug: jest.fn(), log: jest.fn() }) }
      } as never)
      // Holds the first request inside the gate so the second one arrives while it is still occupied.
      getTrendingItems.mockImplementation(
        () => new Promise(resolve => (releaseTrending = () => resolve({ data: [{ contractAddress: ADDRESS, itemId: '1', gender: null }] })))
      )
      const held = suggestions.getSuggestions({}, RATE)
      const shed = await Promise.all([
        suggestions.getSuggestions({ first: 7 }, RATE),
        suggestions.getSuggestions({ first: 8 }, RATE),
        suggestions.getSuggestions({ first: 9 }, RATE)
      ])
      releaseTrending()
      results = [await held, ...shed]
    })

    it('should serve the request that got in', () => {
      expect(results[0].data).toHaveLength(1)
    })

    it('should shed the one that did not, rather than queue it behind the database', () => {
      expect(results[1].data).toEqual([])
    })

    it('should mark the shed rail unpersonalised, which is what makes the Shop hide it', () => {
      expect(results[1].personalized).toBe(false)
    })

    it('should not touch the catalogue for the shed request', () => {
      expect(getTrendingItems).toHaveBeenCalledTimes(1)
    })

    it('should not cache the shed answer, which would serve emptiness for the whole TTL', () => {
      expect(cacheSet).toHaveBeenCalledTimes(1)
    })

    it('should say so once rather than once per shed request, since saturation arrives as a burst', () => {
      expect(warn).toHaveBeenCalledTimes(1)
    })

    it('should carry a running total, so the sheds it stayed quiet about are still countable', () => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('request(s) since start'))
    })
  })

  describe('and the configured concurrency limit is not a positive integer', () => {
    let result: Awaited<ReturnType<ISuggestionsComponent['getSuggestions']>>
    let warn: jest.Mock

    beforeEach(async () => {
      warn = jest.fn()
      suggestions = await createSuggestionsComponent({
        dappsDatabase: { query },
        shopCatalog: { getTrendingItems },
        cache: { get: cacheGet, set: cacheSet },
        config: { getNumber: async () => 0 },
        logs: { getLogger: () => ({ info: jest.fn(), warn, error: jest.fn(), debug: jest.fn(), log: jest.fn() }) }
      } as never)
      getTrendingItems.mockResolvedValue({ data: [{ contractAddress: ADDRESS, itemId: '1', gender: null }] })
      result = await suggestions.getSuggestions({}, RATE)
    })

    it('should fall back to the built-in limit rather than shed every request forever', () => {
      expect(result.data).toHaveLength(1)
    })

    it('should say which setting it ignored, so the misconfiguration is findable', () => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('SUGGESTIONS_MAX_CONCURRENT'))
    })
  })

  describe('and a real cache sits between two callers', () => {
    let store: Map<string, unknown>
    let cachedSuggestions: ISuggestionsComponent
    let signedA: Awaited<ReturnType<ISuggestionsComponent['getSuggestions']>>
    let anonA: Awaited<ReturnType<ISuggestionsComponent['getSuggestions']>>
    let signedB: Awaited<ReturnType<ISuggestionsComponent['getSuggestions']>>

    const OTHER = '0x000000000000000000000000000000000000dead'

    beforeEach(async () => {
      // A cache that really stores and really serves, rather than two key strings compared by eye. If the
      // key is wrong, the second caller gets the FIRST caller's answer here and the assertion sees it.
      store = new Map()
      const rows = () => [
        [{ item_id: '0xaaa-1', acquired_at: '1700000000' }],
        [],
        [{ contract: '0xc0' }],
        Array.from({ length: 8 }, (_, i) => candidateRow(i))
      ]
      cachedSuggestions = await createSuggestionsComponent({
        dappsDatabase: { query },
        shopCatalog: { getTrendingItems },
        lists: { getPicksByListId },
        cache: {
          get: async (key: string) => store.get(key),
          set: async (key: string, value: unknown) => {
            store.set(key, value)
          }
        },
        config: { getNumber: async () => undefined },
        logs: { getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() }) }
      } as never)
      getPicksByListId.mockResolvedValue([{ item_id: '0xbbb-2' }])

      queryRows = rows()
      signedA = await cachedSuggestions.getSuggestions({ address: ADDRESS, verifiedAddress: ADDRESS }, RATE)
      queryRows = rows()
      anonA = await cachedSuggestions.getSuggestions({ address: ADDRESS }, RATE)
      queryRows = rows()
      signedB = await cachedSuggestions.getSuggestions({ address: ADDRESS, verifiedAddress: OTHER }, RATE)
    })

    it('should compute the unsigned answer rather than serve the signed one out of the cache', () => {
      expect(store.size).toBeGreaterThan(1)
    })

    it('should read the favorites once, for the caller who proved the account', () => {
      expect(getPicksByListId).toHaveBeenCalledTimes(1)
    })

    it('should answer all three, so the separation costs correctness nothing', () => {
      expect([signedA.algorithm, anonA.algorithm, signedB.algorithm]).toEqual(['v1', 'v1', 'v1'])
    })
  })

  describe('and the caller signed but named nobody', () => {
    beforeEach(async () => {
      getPicksByListId.mockResolvedValue([{ item_id: '0xbbb-2' }])
      queryRows = [
        [{ item_id: '0xaaa-1', acquired_at: '1700000000' }],
        [],
        [{ contract: '0xc0' }],
        Array.from({ length: 8 }, (_, i) => candidateRow(i))
      ]
      await suggestions.getSuggestions({ verifiedAddress: ADDRESS }, RATE)
    })

    it('should treat the proven identity as the wallet in question, rather than read half of it', () => {
      const ownedQuery = query.mock.calls.find(call => String(call[0].text ?? '').includes('owner_address'))
      expect(ownedQuery?.[0].values).toContain(ADDRESS)
    })
  })
})
