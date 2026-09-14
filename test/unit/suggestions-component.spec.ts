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

  describe('and the favorites store is unavailable', () => {
    beforeEach(async () => {
      getPicksByListId.mockRejectedValue(new Error('favorites down'))
      queryRows = [
        [{ item_id: '0xaaa-1', acquired_at: '1700000000', paid: true }],
        [],
        [{ contract: '0xc0' }],
        Array.from({ length: 8 }, (_, i) => candidateRow(i))
      ]
    })

    it('should still answer, losing the favorites signal rather than the whole rail', async () => {
      const result = await suggestions.getSuggestions({ address: ADDRESS }, RATE)
      expect(result.personalized).toBe(true)
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
})
