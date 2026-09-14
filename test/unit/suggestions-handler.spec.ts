/* eslint-disable @typescript-eslint/unbound-method */
import { URL } from 'url'
import { createShopSuggestedHandler } from '../../src/controllers/handlers/shop-catalog-handler'
import { SUGGESTED_DEFAULT_LIMIT } from '../../src/logic/suggestions/constants'
import type { SuggestionsFilters } from '../../src/ports/suggestions/types'

const ADDRESS = '0x1096f950841a99f9b961434714d9a08d3d4ebdff'

describe('when fetching suggested items', () => {
  let getSuggestions: jest.Mock
  let components: { suggestions: { getSuggestions: jest.Mock }; manaUsdRate: { getRate: jest.Mock } }

  /** The handler only reads `url` and `components`; `next` exists to satisfy the middleware signature. */
  async function invoke(query: string): Promise<{ body?: unknown }> {
    const context = {
      url: new URL(`http://localhost:3000/v3/catalog/suggested${query}`),
      components
    } as never
    const next = (() => Promise.resolve(undefined)) as never
    return (await createShopSuggestedHandler(components as never)(context, next)) as { body?: unknown }
  }

  function filtersPassed(): SuggestionsFilters {
    return getSuggestions.mock.calls[0][0] as SuggestionsFilters
  }

  beforeEach(() => {
    getSuggestions = jest.fn().mockResolvedValue({ data: [], personalized: false, algorithm: 'v1' })
    components = {
      suggestions: { getSuggestions },
      manaUsdRate: { getRate: jest.fn().mockReturnValue(0.02) }
    }
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('and no parameters are given', () => {
    beforeEach(async () => {
      await invoke('')
    })

    it('should ask for the default rail size', () => {
      expect(filtersPassed().first).toBe(SUGGESTED_DEFAULT_LIMIT)
    })

    it('should ask anonymously rather than refusing the request', () => {
      expect(filtersPassed().address).toBeUndefined()
    })
  })

  describe('and an address is given', () => {
    beforeEach(async () => {
      await invoke(`?address=${ADDRESS}`)
    })

    it('should pass it through', () => {
      expect(filtersPassed().address).toBe(ADDRESS)
    })
  })

  describe('and the address is not a valid one', () => {
    beforeEach(async () => {
      await invoke('?address=not-an-address')
    })

    it('should drop it and answer anonymously instead of erroring', () => {
      expect(filtersPassed().address).toBeUndefined()
    })
  })

  describe('and seeds are given as a comma-separated list', () => {
    beforeEach(async () => {
      await invoke(`?seeds=${ADDRESS}-1,${ADDRESS}-2`)
    })

    it('should pass each one through', () => {
      expect(filtersPassed().seeds).toEqual([`${ADDRESS}-1`, `${ADDRESS}-2`])
    })
  })

  describe('and equipped URNs are given', () => {
    beforeEach(async () => {
      await invoke(`?equipped=urn:decentraland:matic:collections-v2:${ADDRESS}:1`)
    })

    it('should pass them through for the component to resolve', () => {
      expect(filtersPassed().equipped).toEqual([`urn:decentraland:matic:collections-v2:${ADDRESS}:1`])
    })
  })

  describe('and an exclude list and a body shape are given', () => {
    beforeEach(async () => {
      await invoke(`?exclude=${ADDRESS}-9&bodyShape=BaseFemale`)
    })

    it('should pass the anchor to exclude', () => {
      expect(filtersPassed().exclude).toEqual([`${ADDRESS}-9`])
    })

    it('should pass the body shape so incompatible wearables can be filtered out', () => {
      expect(filtersPassed().bodyShape).toBe('BaseFemale')
    })
  })

  describe('and the rail size asked for is above the maximum', () => {
    beforeEach(async () => {
      await invoke('?first=500')
    })

    it('should forward it for the component to clamp rather than rejecting the request', () => {
      expect(filtersPassed().first).toBe(500)
    })
  })

  describe('and the component answers', () => {
    let response: { body?: unknown }

    beforeEach(async () => {
      getSuggestions.mockResolvedValue({ data: [{ itemId: '1' }], personalized: true, algorithm: 'v1' })
      response = await invoke('')
    })

    it('should return the rows alongside whether they are personalised and which algorithm produced them', () => {
      expect(response.body).toEqual({ data: [{ itemId: '1' }], personalized: true, algorithm: 'v1' })
    })
  })

  describe('and the current MANA rate is needed to price the rows', () => {
    beforeEach(async () => {
      await invoke('')
    })

    it('should pass the live rate so prices match the browse grid', () => {
      expect(getSuggestions.mock.calls[0][1]).toBe(0.02)
    })
  })
})
