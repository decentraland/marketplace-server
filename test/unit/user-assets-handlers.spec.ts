import { URLSearchParams } from 'url'
import { WearableCategory, EmoteCategory } from '@dcl/schemas'
import { getUserEmotesHandler, getUserEmotesUrnTokenHandler } from '../../src/controllers/handlers/user-assets/emotes-handler'
import { getUserNamesHandler, getUserNamesOnlyHandler } from '../../src/controllers/handlers/user-assets/names-handler'
import {
  getUserWearablesHandler,
  getUserWearablesUrnTokenHandler,
  getUserGroupedWearablesHandler
} from '../../src/controllers/handlers/user-assets/wearables-handler'
import { getUserAssetsParams } from '../../src/controllers/handlers/utils'
import { Params } from '../../src/logic/http/params'
import { ItemType } from '../../src/ports/items/types'
import { IUserAssetsComponent } from '../../src/ports/user-assets/types'

describe('User Assets Handlers', () => {
  let mockUserAssets: jest.Mocked<IUserAssetsComponent>
  let mockContext: any
  let searchParams: URLSearchParams

  beforeEach(() => {
    mockUserAssets = {
      getWearablesByOwner: jest.fn(),
      getOwnedWearablesUrnAndTokenId: jest.fn(),
      getEmotesByOwner: jest.fn(),
      getOwnedEmotesUrnAndTokenId: jest.fn(),
      getNamesByOwner: jest.fn(),
      getOwnedNamesOnly: jest.fn(),
      getGroupedWearablesByOwner: jest.fn(),
      getGroupedEmotesByOwner: jest.fn()
    }

    searchParams = new URLSearchParams()
    mockContext = {
      params: { address: '0x1234567890abcdef' },
      url: { searchParams },
      components: { userAssets: mockUserAssets }
    }
  })

  describe('when fetching user wearables', () => {
    const mockWearables = [
      {
        id: '1',
        name: 'Cool Hat',
        urn: 'urn:test:1',
        tokenId: '1',
        category: WearableCategory.HAT,
        transferredAt: '1672531200000',
        rarity: 'common',
        price: 100
      },
      {
        id: '2',
        name: 'Nice Shoes',
        urn: 'urn:test:2',
        tokenId: '2',
        category: WearableCategory.FEET,
        transferredAt: '1672531200000',
        rarity: 'rare'
      }
    ]

    beforeEach(() => {
      mockUserAssets.getWearablesByOwner.mockResolvedValue({
        data: mockWearables,
        total: 50,
        totalItems: 25
      })
    })

    it('should return paginated wearables data', async () => {
      searchParams.set('first', '10')
      searchParams.set('skip', '20')

      const result = await getUserWearablesHandler(mockContext)

      expect(result).toEqual({
        status: 200,
        body: {
          ok: true,
          data: {
            elements: mockWearables,
            page: 3, // (20 / 10) + 1
            pages: 5, // Math.ceil(50 / 10)
            limit: 10,
            total: 50,
            totalItems: 25
          }
        }
      })

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockUserAssets.getWearablesByOwner).toHaveBeenCalledWith('0x1234567890abcdef', 10, 20)
    })

    it('should handle errors gracefully', async () => {
      mockUserAssets.getWearablesByOwner.mockRejectedValue(new Error('Database error'))

      const result = await getUserWearablesHandler(mockContext)

      expect(result).toEqual({
        status: 500,
        body: {
          ok: false,
          message: 'Failed to fetch user wearables',
          data: { error: 'Database error' }
        }
      })
    })

    it('should use default pagination when no params provided', async () => {
      await getUserWearablesHandler(mockContext)

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockUserAssets.getWearablesByOwner).toHaveBeenCalledWith('0x1234567890abcdef', 100, 0)
    })

    it('should return multiple wearables with same URN as separate elements', async () => {
      const duplicateUrnWearables = [
        {
          id: '1',
          name: 'Cool Hat',
          urn: 'urn:test:same',
          tokenId: '1',
          category: WearableCategory.HAT,
          transferredAt: '1672531200000',
          rarity: 'common',
          price: 100
        },
        {
          id: '2',
          name: 'Cool Hat',
          urn: 'urn:test:same',
          tokenId: '2',
          category: WearableCategory.HAT,
          transferredAt: '1672617600000',
          rarity: 'common',
          price: 150
        },
        {
          id: '3',
          name: 'Cool Hat',
          urn: 'urn:test:same',
          tokenId: '3',
          category: WearableCategory.HAT,
          transferredAt: '1672704000000',
          rarity: 'common'
        }
      ]

      mockUserAssets.getWearablesByOwner.mockResolvedValue({
        data: duplicateUrnWearables,
        total: 3,
        totalItems: 1
      })

      const result = await getUserWearablesHandler(mockContext)

      expect(result).toEqual({
        status: 200,
        body: {
          ok: true,
          data: {
            elements: duplicateUrnWearables,
            page: 1,
            pages: 1,
            limit: 100,
            total: 3,
            totalItems: 1
          }
        }
      })

      // Verify we get 3 separate elements even though they have the same URN
      if (result.body.ok) {
        const elements = (result.body.data as { elements: unknown[] }).elements
        expect(elements).toHaveLength(3)
        expect((elements[0] as { tokenId: string }).tokenId).toBe('1')
        expect((elements[1] as { tokenId: string }).tokenId).toBe('2')
        expect((elements[2] as { tokenId: string }).tokenId).toBe('3')
        // Verify prices are included
        expect((elements[0] as { price?: number }).price).toBe(100)
        expect((elements[1] as { price?: number }).price).toBe(150)
        expect((elements[2] as { price?: number }).price).toBeUndefined()
      }
    })

    it('should handle null transferredAt values', async () => {
      const wearablesWithNullTransferred = [
        {
          id: '1',
          name: 'Cool Hat',
          urn: 'urn:test:1',
          tokenId: '1',
          category: WearableCategory.HAT,
          transferredAt: null,
          rarity: 'common',
          price: 100
        }
      ]

      mockUserAssets.getWearablesByOwner.mockResolvedValue({
        data: wearablesWithNullTransferred,
        total: 1,
        totalItems: 1
      })

      const result = await getUserWearablesHandler(mockContext)

      expect(result.status).toBe(200)
      if (result.body.ok) {
        const elements = (result.body.data as { elements: { transferredAt: string | null; price?: number }[] }).elements
        expect(elements[0].transferredAt).toBeNull()
        expect(elements[0].price).toBe(100)
      }
    })
  })

  describe('when fetching minimal wearable data', () => {
    const mockData = [
      { urn: 'urn:test:1', tokenId: '1' },
      { urn: 'urn:test:2', tokenId: '2' }
    ]

    beforeEach(() => {
      mockUserAssets.getOwnedWearablesUrnAndTokenId.mockResolvedValue({
        data: mockData,
        total: 25
      })
    })

    it('should return minimal wearables data', async () => {
      searchParams.set('first', '5')
      searchParams.set('skip', '10')

      const result = await getUserWearablesUrnTokenHandler(mockContext)

      expect(result).toEqual({
        status: 200,
        body: {
          ok: true,
          data: {
            elements: mockData,
            page: 3, // (10 / 5) + 1
            pages: 5, // Math.ceil(25 / 5)
            limit: 5,
            total: 25
          }
        }
      })
    })
  })

  describe('when fetching user emotes', () => {
    const mockEmotes = [
      {
        id: '1',
        name: 'Dance',
        urn: 'urn:emote:1',
        tokenId: '100',
        category: EmoteCategory.DANCE,
        transferredAt: '1672531200000',
        rarity: 'epic',
        price: 50
      },
      {
        id: '2',
        name: 'Wave',
        urn: 'urn:emote:2',
        tokenId: '101',
        category: EmoteCategory.GREETINGS,
        transferredAt: '1672617600000',
        rarity: 'rare'
      }
    ]

    beforeEach(() => {
      mockUserAssets.getEmotesByOwner.mockResolvedValue({
        data: mockEmotes,
        total: 30,
        totalItems: 2
      })
    })

    it('should return paginated emotes data', async () => {
      searchParams.set('first', '15')
      searchParams.set('skip', '0')

      const result = await getUserEmotesHandler(mockContext)

      expect(result).toEqual({
        status: 200,
        body: {
          ok: true,
          data: {
            elements: mockEmotes,
            page: 1,
            pages: 2, // Math.ceil(30 / 15)
            limit: 15,
            total: 30,
            totalItems: 2
          }
        }
      })
    })

    it('should handle errors gracefully', async () => {
      mockUserAssets.getEmotesByOwner.mockRejectedValue(new Error('Network error'))

      const result = await getUserEmotesHandler(mockContext)

      expect(result).toEqual({
        status: 500,
        body: {
          ok: false,
          message: 'Failed to fetch user emotes',
          data: { error: 'Network error' }
        }
      })
    })
  })

  describe('when fetching minimal emote data', () => {
    const mockData = [
      { urn: 'urn:emote:1', tokenId: '100' },
      { urn: 'urn:emote:2', tokenId: '101' }
    ]

    beforeEach(() => {
      mockUserAssets.getOwnedEmotesUrnAndTokenId.mockResolvedValue({
        data: mockData,
        total: 15
      })
    })

    it('should return minimal emotes data', async () => {
      const result = await getUserEmotesUrnTokenHandler(mockContext)

      expect(result.status).toBe(200)
      expect(result.body.ok).toBe(true)
      if (result.body.ok) {
        const resultData = result.body.data as { elements: { urn: string; tokenId: string }[]; total: number }
        expect(resultData.elements).toEqual(mockData)
        expect(resultData.total).toBe(15)
      }
    })
  })

  describe('when fetching user names', () => {
    const mockNames = [
      {
        name: 'coolname.dcl.eth',
        contractAddress: '0x2a187453c19c7a7c3459bafc8bb932e7459d2a1c',
        tokenId: '123',
        price: 1000
      },
      {
        name: 'awesome.dcl.eth',
        contractAddress: '0x2a187453c19c7a7c3459bafc8bb932e7459d2a1c',
        tokenId: '124'
      }
    ]

    beforeEach(() => {
      mockUserAssets.getNamesByOwner.mockResolvedValue({
        data: mockNames,
        total: 8
      })
    })

    it('should return paginated names data', async () => {
      searchParams.set('first', '5')
      searchParams.set('skip', '0')

      const result = await getUserNamesHandler(mockContext)

      expect(result).toEqual({
        status: 200,
        body: {
          ok: true,
          data: {
            elements: mockNames,
            page: 1,
            pages: 2, // Math.ceil(8 / 5)
            limit: 5,
            total: 8
          }
        }
      })

      // Verify first name has price from active order, second has no price
      if (result.body.ok) {
        const elements = result.body.data as { elements: { price?: number }[] }
        expect(elements.elements[0].price).toBe(1000)
        expect(elements.elements[1].price).toBeUndefined()
      }
    })

    it('should handle names without active orders (no price)', async () => {
      const namesWithoutOrders = [
        {
          name: 'noorder.dcl.eth',
          contractAddress: '0x2a187453c19c7a7c3459bafc8bb932e7459d2a1c',
          tokenId: '999'
        }
      ]

      mockUserAssets.getNamesByOwner.mockResolvedValue({
        data: namesWithoutOrders,
        total: 1
      })

      const result = await getUserNamesHandler(mockContext)

      expect(result.status).toBe(200)
      if (result.body.ok) {
        const elements = result.body.data as { elements: { name: string; price?: number }[] }
        expect(elements.elements[0].name).toBe('noorder.dcl.eth')
        expect(elements.elements[0].price).toBeUndefined()
      }
    })

    it('should handle errors gracefully', async () => {
      mockUserAssets.getNamesByOwner.mockRejectedValue(new Error('Service unavailable'))

      const result = await getUserNamesHandler(mockContext)

      expect(result).toEqual({
        status: 500,
        body: {
          ok: false,
          message: 'Failed to fetch user names',
          data: { error: 'Service unavailable' }
        }
      })
    })
  })

  describe('when fetching minimal names data', () => {
    const mockData = [{ name: 'coolname' }, { name: 'awesome' }]

    beforeEach(() => {
      mockUserAssets.getOwnedNamesOnly.mockResolvedValue({
        data: mockData,
        total: 12
      })
    })

    it('should return minimal names data', async () => {
      searchParams.set('first', '20')
      searchParams.set('skip', '0')

      const result = await getUserNamesOnlyHandler(mockContext)

      expect(result).toEqual({
        status: 200,
        body: {
          ok: true,
          data: {
            elements: mockData,
            page: 1,
            pages: 1, // Math.ceil(12 / 20)
            limit: 20,
            total: 12
          }
        }
      })
    })

    it('should handle non-Error exceptions', async () => {
      mockUserAssets.getOwnedNamesOnly.mockRejectedValue('String error')

      const result = await getUserNamesOnlyHandler(mockContext)

      expect(result).toEqual({
        status: 500,
        body: {
          ok: false,
          message: 'Failed to fetch user names data',
          data: undefined // Non-Error exceptions don't include error details
        }
      })
    })
  })

  describe('when fetching grouped user wearables', () => {
    const mockGroupedWearables = [
      {
        urn: 'urn:decentraland:polygon:collections-v2:0x123:item1',
        amount: 3,
        individualData: [
          {
            id: 'urn:decentraland:polygon:collections-v2:0x123:item1:1',
            tokenId: '1',
            transferredAt: '1640995200',
            price: '100'
          }
        ],
        name: 'Cool Glasses',
        rarity: 'common',
        minTransferredAt: 1640995200,
        maxTransferredAt: 1641081600,
        category: WearableCategory.EYEWEAR,
        itemType: ItemType.WEARABLE_V2
      }
    ]

    beforeEach(() => {
      mockUserAssets.getGroupedWearablesByOwner.mockResolvedValue({
        data: mockGroupedWearables,
        total: 15
      })
    })

    it('should return paginated grouped wearables data', async () => {
      searchParams.set('first', '10')
      searchParams.set('skip', '0')

      const result = await getUserGroupedWearablesHandler(mockContext)

      expect(result).toEqual({
        status: 200,
        body: {
          ok: true,
          data: {
            elements: mockGroupedWearables,
            page: 1,
            pages: 2, // Math.ceil(15 / 10)
            limit: 10,
            total: 15
          }
        }
      })

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockUserAssets.getGroupedWearablesByOwner).toHaveBeenCalledWith('0x1234567890abcdef', {
        first: 10,
        skip: 0
      })
    })

    it('should handle array of itemType parameter', async () => {
      searchParams.set('itemType', 'wearable_v1')
      searchParams.append('itemType', 'wearable_v2')

      await getUserGroupedWearablesHandler(mockContext)

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockUserAssets.getGroupedWearablesByOwner).toHaveBeenCalledWith('0x1234567890abcdef', {
        first: 100,
        skip: 0,
        itemType: ['wearable_v1', 'wearable_v2']
      })
    })

    it('should handle single itemType parameter', async () => {
      searchParams.set('itemType', 'smart_wearable_v1')

      await getUserGroupedWearablesHandler(mockContext)

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockUserAssets.getGroupedWearablesByOwner).toHaveBeenCalledWith('0x1234567890abcdef', {
        first: 100,
        skip: 0,
        itemType: ['smart_wearable_v1']
      })
    })

    it('should handle errors gracefully', async () => {
      mockUserAssets.getGroupedWearablesByOwner.mockRejectedValue(new Error('Database error'))

      const result = await getUserGroupedWearablesHandler(mockContext)

      expect(result).toEqual({
        status: 500,
        body: {
          ok: false,
          message: 'Failed to fetch user grouped wearables',
          data: { error: 'Database error' }
        }
      })
    })
  })
})

describe('getUserAssetsParams', () => {
  it('should handle limit parameter up to 1000', () => {
    const searchParams = new URLSearchParams({ limit: '1000', offset: '0' })
    const params = new Params(searchParams)
    const result = getUserAssetsParams(params)

    expect(result.first).toBe(1000)
    expect(result.skip).toBe(0)
  })

  it('should cap limit at 1000 when higher value is provided', () => {
    const searchParams = new URLSearchParams({ limit: '2000', offset: '0' })
    const params = new Params(searchParams)
    const result = getUserAssetsParams(params)

    expect(result.first).toBe(1000) // Should be capped at 1000
    expect(result.skip).toBe(0)
  })

  it('should fallback to first parameter if limit is not provided', () => {
    const searchParams = new URLSearchParams({ first: '500', skip: '10' })
    const params = new Params(searchParams)
    const result = getUserAssetsParams(params)

    expect(result.first).toBe(500)
    expect(result.skip).toBe(10)
  })

  it('should use default value when no limit or first is provided', () => {
    const searchParams = new URLSearchParams({})
    const params = new Params(searchParams)
    const result = getUserAssetsParams(params)

    expect(result.first).toBe(100) // Default value
    expect(result.skip).toBe(0) // Default value
  })

  it('should handle array of itemType parameter', () => {
    const searchParams = new URLSearchParams()
    searchParams.set('itemType', 'wearable_v1')
    searchParams.append('itemType', 'wearable_v2')
    const params = new Params(searchParams)
    const result = getUserAssetsParams(params)

    expect(result.itemType).toEqual(['wearable_v1', 'wearable_v2'])
  })

  it('should handle single itemType parameter as array', () => {
    const searchParams = new URLSearchParams({ itemType: 'smart_wearable_v1' })
    const params = new Params(searchParams)
    const result = getUserAssetsParams(params)

    expect(result.itemType).toEqual(['smart_wearable_v1'])
  })

  it('should return undefined itemType when not provided', () => {
    const searchParams = new URLSearchParams({})
    const params = new Params(searchParams)
    const result = getUserAssetsParams(params)

    expect(result.itemType).toBeUndefined()
  })
})
