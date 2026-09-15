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
  async function invoke(query: string, verification?: { auth: string }): Promise<{ body?: unknown; headers?: Record<string, string> }> {
    const context = {
      url: new URL(`http://localhost:3000/v3/catalog/suggested${query}`),
      components,
      verification
    } as never
    const next = (() => Promise.resolve(undefined)) as never
    return (await createShopSuggestedHandler(components as never)(context, next)) as {
      body?: unknown
      headers?: Record<string, string>
    }
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

  describe('and the response leaves the process', () => {
    let response: { headers?: Record<string, string> }

    beforeEach(async () => {
      response = await invoke('')
    })

    it('should forbid any shared cache from storing it, since the signature is not in a header a cache keys on', () => {
      expect(response.headers?.['Cache-Control']).toBe('private, no-store')
    })
  })

  describe('and the caller signed the request', () => {
    beforeEach(async () => {
      await invoke(`?address=${ADDRESS}`, { auth: `0x${'A'.repeat(38)}FF` })
    })

    it('should pass the proven identity down, lowercased, apart from the address anyone can type', () => {
      expect(filtersPassed().verifiedAddress).toBe(`0x${'a'.repeat(38)}ff`)
    })

    it('should still carry no-store, because a signed answer is the one that must never be shared', async () => {
      const response = await invoke(`?address=${ADDRESS}`, { auth: ADDRESS })
      expect(response.headers?.['Cache-Control']).toBe('private, no-store')
    })
  })

  describe('and the caller forges a verifiedAddress in the query string', () => {
    beforeEach(async () => {
      await invoke(`?address=${ADDRESS}&verifiedAddress=${ADDRESS}`)
    })

    it('should ignore it, because only the middleware can establish an identity', () => {
      expect(filtersPassed().verifiedAddress).toBeUndefined()
    })
  })

  describe('and the request carries no signature at all', () => {
    beforeEach(async () => {
      await invoke(`?address=${ADDRESS}`)
    })

    it('should pass no identity, which is what keeps favorites out of an unsigned answer', () => {
      expect(filtersPassed().verifiedAddress).toBeUndefined()
    })
  })
})
