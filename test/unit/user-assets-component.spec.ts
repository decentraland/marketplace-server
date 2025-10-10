import { createUserAssetsComponent } from '../../src/ports/user-assets/component'
import { IUserAssetsComponent } from '../../src/ports/user-assets/types'

describe('User Assets Component', () => {
  let userAssetsComponent: IUserAssetsComponent
  let mockClient: any
  let mockLogger: any
  let mockPool: any

  beforeEach(async () => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    }

    mockLogger = {
      debug: jest.fn(),
      error: jest.fn()
    }

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient)
    }

    const mockComponents = {
      logs: {
        getLogger: jest.fn().mockReturnValue(mockLogger)
      },
      dappsDatabase: {
        getPool: jest.fn().mockReturnValue(mockPool)
      }
    } as any

    userAssetsComponent = await createUserAssetsComponent(mockComponents)
  })

  describe('when fetching user wearables', () => {
    it('should fetch wearables with pagination', async () => {
      const mockDataRows = [
        {
          id: '1',
          contract_address: '0x123',
          token_id: '1',
          urn: 'urn:decentraland:polygon:collections-v2:0x123:1',
          category: 'eyewear',
          name: 'Cool Glasses',
          rarity: 'common',
          created_at: '2023-01-01',
          price: 100
        }
      ]
      const mockCountRow = { total: '50' }
      const mockUniqueItemsRow = { total_items: '25' }

      mockClient.query
        .mockResolvedValueOnce({ rows: mockDataRows })
        .mockResolvedValueOnce({ rows: [mockCountRow] })
        .mockResolvedValueOnce({ rows: [mockUniqueItemsRow] })

      const result = await userAssetsComponent.getWearablesByOwner('0xowner', 10, 20)

      expect(result).toEqual({
        data: expect.any(Array),
        total: 50,
        totalItems: 25
      })
      expect(mockClient.query).toHaveBeenCalledTimes(3)
      expect(mockClient.release).toHaveBeenCalledTimes(1)
      expect(mockLogger.debug).toHaveBeenCalled()
    })

    it('should handle database errors', async () => {
      mockClient.query.mockRejectedValue(new Error('Database error'))

      await expect(userAssetsComponent.getWearablesByOwner('0xowner')).rejects.toThrow('Database error')
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('should use default pagination values', async () => {
      const mockDataRows: unknown[] = []
      const mockCountRow = { total: '0' }
      const mockUniqueItemsRow = { total_items: '0' }

      mockClient.query
        .mockResolvedValueOnce({ rows: mockDataRows })
        .mockResolvedValueOnce({ rows: [mockCountRow] })
        .mockResolvedValueOnce({ rows: [mockUniqueItemsRow] })

      const result = await userAssetsComponent.getWearablesByOwner('0xowner')

      expect(result).toEqual({
        data: [],
        total: 0,
        totalItems: 0
      })
      expect(mockClient.query).toHaveBeenCalledTimes(3)
    })
  })

  describe('when fetching grouped wearables', () => {
    it('should fetch grouped wearables with pagination', async () => {
      const mockGroupedDataRows = [
        {
          urn: 'urn:decentraland:polygon:collections-v2:0x123:item1',
          category: 'eyewear',
          rarity: 'common',
          name: 'Cool Glasses',
          amount: 3,
          min_transferred_at: 1640995200,
          max_transferred_at: 1641081600,
          individual_data: [
            {
              id: 'urn:decentraland:polygon:collections-v2:0x123:item1:1',
              tokenId: '1',
              transferredAt: 1640995200,
              price: 100
            },
            {
              id: 'urn:decentraland:polygon:collections-v2:0x123:item1:2',
              tokenId: '2',
              transferredAt: 1641081600,
              price: 150
            }
          ]
        }
      ]
      const mockCountRow = { total: '15' }

      mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

      const result = await userAssetsComponent.getGroupedWearablesByOwner('0xowner', { first: 10, skip: 0 })

      expect(result).toEqual({
        data: expect.any(Array),
        total: 15
      })
      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toMatchObject({
        urn: 'urn:decentraland:polygon:collections-v2:0x123:item1',
        amount: 3,
        individualData: expect.any(Array),
        name: 'Cool Glasses',
        rarity: 'common',
        category: 'eyewear'
      })
      expect(mockClient.query).toHaveBeenCalledTimes(2)
      expect(mockClient.release).toHaveBeenCalledTimes(1)
      expect(mockLogger.debug).toHaveBeenCalled()
    })

    it('should handle database errors for grouped wearables', async () => {
      mockClient.query.mockRejectedValue(new Error('Database error'))

      await expect(userAssetsComponent.getGroupedWearablesByOwner('0xowner')).rejects.toThrow('Database error')
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe('when fetching minimal wearable data', () => {
    it('should fetch minimal wearable data with pagination', async () => {
      const mockDataRows = [
        {
          urn: 'urn:decentraland:polygon:collections-v2:0x123:1',
          token_id: '1'
        }
      ]
      const mockCountRow = { total: '25' }

      mockClient.query.mockResolvedValueOnce({ rows: mockDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

      const result = await userAssetsComponent.getOwnedWearablesUrnAndTokenId('0xowner', 5, 10)

      expect(result).toEqual({
        data: expect.any(Array),
        total: 25
      })
      expect(mockClient.query).toHaveBeenCalledTimes(2)
    })
  })

  describe('when fetching user emotes', () => {
    it('should fetch emotes with pagination', async () => {
      const mockDataRows = [
        {
          id: '1',
          contract_address: '0x123',
          token_id: '1',
          urn: 'urn:decentraland:polygon:collections-v2:0x123:1',
          category: 'dance',
          name: 'Cool Dance',
          rarity: 'rare',
          created_at: '2023-01-01',
          price: 200
        }
      ]
      const mockCountRow = { total: '30' }
      const mockUniqueItemsRow = { total_items: '15' }

      mockClient.query
        .mockResolvedValueOnce({ rows: mockDataRows })
        .mockResolvedValueOnce({ rows: [mockCountRow] })
        .mockResolvedValueOnce({ rows: [mockUniqueItemsRow] })

      const result = await userAssetsComponent.getEmotesByOwner('0xowner', 5, 10)

      expect(result).toEqual({
        data: expect.any(Array),
        total: 30,
        totalItems: 15
      })
      expect(mockClient.query).toHaveBeenCalledTimes(3)
    })
  })

  describe('when fetching grouped emotes', () => {
    it('should fetch grouped emotes with pagination', async () => {
      const mockGroupedDataRows = [
        {
          urn: 'urn:decentraland:polygon:collections-v2:0x123:emote1',
          category: 'dance',
          rarity: 'rare',
          name: 'Cool Dance',
          amount: 2,
          min_transferred_at: 1640995200,
          max_transferred_at: 1641081600,
          individual_data: [
            {
              id: 'urn:decentraland:polygon:collections-v2:0x123:emote1:1',
              tokenId: '1',
              transferredAt: 1640995200,
              price: 200
            }
          ]
        }
      ]
      const mockCountRow = { total: '8' }

      mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

      const result = await userAssetsComponent.getGroupedEmotesByOwner('0xowner', { first: 10, skip: 0 })

      expect(result).toEqual({
        data: expect.any(Array),
        total: 8
      })
      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toMatchObject({
        urn: 'urn:decentraland:polygon:collections-v2:0x123:emote1',
        amount: 2,
        individualData: expect.any(Array),
        name: 'Cool Dance',
        rarity: 'rare',
        category: 'dance'
      })
      expect(mockClient.query).toHaveBeenCalledTimes(2)
      expect(mockClient.release).toHaveBeenCalledTimes(1)
      expect(mockLogger.debug).toHaveBeenCalled()
    })

    it('should handle database errors for grouped emotes', async () => {
      mockClient.query.mockRejectedValue(new Error('Database error'))

      await expect(userAssetsComponent.getGroupedEmotesByOwner('0xowner')).rejects.toThrow('Database error')
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe('when fetching user names', () => {
    it('should fetch names with pagination', async () => {
      const mockDataRows = [
        {
          contract_address: '0x123',
          token_id: '1',
          name: 'test.dcl.eth',
          price: 1000
        }
      ]
      const mockCountRow = { total: '5' }

      mockClient.query.mockResolvedValueOnce({ rows: mockDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

      const result = await userAssetsComponent.getNamesByOwner('0xowner', { first: 5, skip: 0 })

      expect(result).toEqual({
        data: expect.any(Array),
        total: 5
      })
      expect(mockClient.query).toHaveBeenCalledTimes(2)
    })
  })

  describe('when fetching minimal names data', () => {
    it('should fetch minimal names data with pagination', async () => {
      const mockDataRows = [
        {
          name: 'test.dcl.eth'
        }
      ]
      const mockCountRow = { total: '3' }

      mockClient.query.mockResolvedValueOnce({ rows: mockDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

      const result = await userAssetsComponent.getOwnedNamesOnly('0xowner', 5, 0)

      expect(result).toEqual({
        data: expect.any(Array),
        total: 3
      })
      expect(mockClient.query).toHaveBeenCalledTimes(2)
    })
  })
})
