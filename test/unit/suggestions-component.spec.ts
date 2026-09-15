import { GenderFilterOption } from '@dcl/schemas'
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

  beforeEach(() => {
    queryRows = []
    query = jest.fn(async () => ({ rows: queryRows.shift() ?? [] }))
    getTrendingItems = jest.fn(async () => ({ data: [{ name: 'Trending item', trendingSales: 3 }] }))
    getPicksByListId = jest.fn(async () => [])
    cacheGet = jest.fn(async () => undefined)
    cacheSet = jest.fn(async () => undefined)

    suggestions = createSuggestionsComponent({
      dappsDatabase: { query },
      shopCatalog: { getTrendingItems },
      lists: { getPicksByListId },
      cache: { get: cacheGet, set: cacheSet },
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

  describe('and the wallet has favorites', () => {
    beforeEach(async () => {
      getPicksByListId.mockResolvedValue([{ itemId: '0xbbb-2' }])
      queryRows = [
        [{ item_id: '0xaaa-1', acquired_at: '1700000000', paid: true }],
        [],
        [{ contract: '0xc0' }],
        Array.from({ length: 8 }, (_, i) => candidateRow(i))
      ]
      await suggestions.getSuggestions({ address: ADDRESS }, RATE)
    })

    it('should never read them, since the endpoint is unsigned and cannot tell whose address this is', () => {
      expect(getPicksByListId).not.toHaveBeenCalled()
    })
  })

  describe('and the rail falls back with hard filters in the request', () => {
    let result: Awaited<ReturnType<ISuggestionsComponent['getSuggestions']>>

    beforeEach(async () => {
      getTrendingItems.mockResolvedValue({
        data: [
          { contractAddress: ADDRESS, itemId: '1', name: 'Excluded' },
          { contractAddress: ADDRESS, itemId: '2', name: 'Kept' }
        ]
      })
      result = await suggestions.getSuggestions({ exclude: [`${ADDRESS}-1`], bodyShape: 'BaseFemale' }, RATE)
    })

    it('should not offer back the item the caller asked it to leave out', () => {
      expect(result.data.map(item => item.itemId)).toEqual(['2'])
    })

    it('should narrow the trending query to what this avatar can wear', () => {
      expect(getTrendingItems.mock.calls[0][0]).toEqual(expect.objectContaining({ wearableGenders: [GenderFilterOption.FEMALE] }))
    })

    it('should ask for more rows than the rail shows, so the exclusion cannot leave it short', () => {
      expect(getTrendingItems.mock.calls[0][0].first).toBeGreaterThan(result.data.length)
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

    it('should not narrow the trending query by a gender it could not resolve', () => {
      expect(getTrendingItems.mock.calls[0][0].wearableGenders).toBeUndefined()
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
})
