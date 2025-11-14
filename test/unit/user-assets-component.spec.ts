import { createUserAssetsComponent } from '../../src/ports/user-assets/component'
import { IUserAssetsComponent, UserAssetsFilters } from '../../src/ports/user-assets/types'

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

    describe('when sorting grouped wearables', () => {
      describe('and sorting by rarity', () => {
        let mockGroupedDataRows: any[]
        let mockCountRow: any

        beforeEach(() => {
          mockGroupedDataRows = [
            {
              urn: 'urn:decentraland:polygon:collections-v2:0x123:rare-item',
              category: 'eyewear',
              rarity: 'rare',
              name: 'Rare Glasses',
              amount: 1,
              min_transferred_at: 1640995200,
              max_transferred_at: 1640995200,
              individual_data: []
            },
            {
              urn: 'urn:decentraland:polygon:collections-v2:0x123:common-item',
              category: 'eyewear',
              rarity: 'common',
              name: 'Common Glasses',
              amount: 1,
              min_transferred_at: 1640995200,
              max_transferred_at: 1640995200,
              individual_data: []
            }
          ]
          mockCountRow = { total: '2' }
        })

        it('should sort by rarity in descending order by default', async () => {
          mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

          await userAssetsComponent.getGroupedWearablesByOwner('0xowner', { first: 10, skip: 0, orderBy: 'rarity' })

          expect(mockClient.query).toHaveBeenCalledTimes(2)
          const sqlQuery = mockClient.query.mock.calls[0][0]
          expect(sqlQuery.text).toContain('ORDER BY rarity_order DESC')
        })

        it('should sort by rarity in ascending order when direction is ASC', async () => {
          mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows.reverse() }).mockResolvedValueOnce({ rows: [mockCountRow] })

          await userAssetsComponent.getGroupedWearablesByOwner('0xowner', { first: 10, skip: 0, orderBy: 'rarity', direction: 'ASC' })

          expect(mockClient.query).toHaveBeenCalledTimes(2)
          const sqlQuery = mockClient.query.mock.calls[0][0]
          expect(sqlQuery.text).toContain('ORDER BY rarity_order ASC')
        })
      })

      describe('and sorting by name', () => {
        let mockGroupedDataRows: any[]
        let mockCountRow: any

        beforeEach(() => {
          mockGroupedDataRows = [
            {
              urn: 'urn:decentraland:polygon:collections-v2:0x123:item1',
              category: 'eyewear',
              rarity: 'common',
              name: 'Alpha Glasses',
              amount: 1,
              min_transferred_at: 1640995200,
              max_transferred_at: 1640995200,
              individual_data: []
            },
            {
              urn: 'urn:decentraland:polygon:collections-v2:0x123:item2',
              category: 'eyewear',
              rarity: 'common',
              name: 'Zeta Glasses',
              amount: 1,
              min_transferred_at: 1640995200,
              max_transferred_at: 1640995200,
              individual_data: []
            }
          ]
          mockCountRow = { total: '2' }
        })

        it('should sort by name in ascending order by default', async () => {
          mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

          await userAssetsComponent.getGroupedWearablesByOwner('0xowner', { first: 10, skip: 0, orderBy: 'name' })

          expect(mockClient.query).toHaveBeenCalledTimes(2)
          const sqlQuery = mockClient.query.mock.calls[0][0]
          expect(sqlQuery.text).toContain('ORDER BY name ASC')
        })

        it('should sort by name in descending order when direction is DESC', async () => {
          mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows.reverse() }).mockResolvedValueOnce({ rows: [mockCountRow] })

          await userAssetsComponent.getGroupedWearablesByOwner('0xowner', { first: 10, skip: 0, orderBy: 'name', direction: 'DESC' })

          expect(mockClient.query).toHaveBeenCalledTimes(2)
          const sqlQuery = mockClient.query.mock.calls[0][0]
          expect(sqlQuery.text).toContain('ORDER BY name DESC')
        })
      })

      describe('and sorting by date', () => {
        let mockGroupedDataRows: any[]
        let mockCountRow: any

        beforeEach(() => {
          mockGroupedDataRows = [
            {
              urn: 'urn:decentraland:polygon:collections-v2:0x123:newest-item',
              category: 'eyewear',
              rarity: 'common',
              name: 'Newest Glasses',
              amount: 1,
              min_transferred_at: 1641081600,
              max_transferred_at: 1641081600,
              individual_data: []
            },
            {
              urn: 'urn:decentraland:polygon:collections-v2:0x123:oldest-item',
              category: 'eyewear',
              rarity: 'common',
              name: 'Oldest Glasses',
              amount: 1,
              min_transferred_at: 1640995200,
              max_transferred_at: 1640995200,
              individual_data: []
            }
          ]
          mockCountRow = { total: '2' }
        })

        it('should sort by date in descending order by default using max_transferred_at', async () => {
          mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

          await userAssetsComponent.getGroupedWearablesByOwner('0xowner', { first: 10, skip: 0, orderBy: 'date' })

          expect(mockClient.query).toHaveBeenCalledTimes(2)
          const sqlQuery = mockClient.query.mock.calls[0][0]
          expect(sqlQuery.text).toContain('ORDER BY max_transferred_at DESC')
        })

        it('should sort by date in ascending order using min_transferred_at when direction is ASC', async () => {
          mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows.reverse() }).mockResolvedValueOnce({ rows: [mockCountRow] })

          await userAssetsComponent.getGroupedWearablesByOwner('0xowner', { first: 10, skip: 0, orderBy: 'date', direction: 'ASC' })

          expect(mockClient.query).toHaveBeenCalledTimes(2)
          const sqlQuery = mockClient.query.mock.calls[0][0]
          expect(sqlQuery.text).toContain('ORDER BY min_transferred_at ASC')
        })
      })

      describe('and no orderBy is provided', () => {
        let mockGroupedDataRows: any[]
        let mockCountRow: any

        beforeEach(() => {
          mockGroupedDataRows = [
            {
              urn: 'urn:decentraland:polygon:collections-v2:0x123:item1',
              category: 'eyewear',
              rarity: 'rare',
              name: 'Test Item',
              amount: 1,
              min_transferred_at: 1640995200,
              max_transferred_at: 1640995200,
              individual_data: []
            }
          ]
          mockCountRow = { total: '1' }
        })

        it('should default to sorting by rarity in descending order', async () => {
          mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

          await userAssetsComponent.getGroupedWearablesByOwner('0xowner', { first: 10, skip: 0 })

          expect(mockClient.query).toHaveBeenCalledTimes(2)
          const sqlQuery = mockClient.query.mock.calls[0][0]
          expect(sqlQuery.text).toContain('ORDER BY rarity_order DESC')
        })
      })
    })

    describe('when filtering grouped wearables by name', () => {
      let mockGroupedDataRows: any[]
      let mockCountRow: any

      beforeEach(() => {
        mockGroupedDataRows = [
          {
            urn: 'urn:decentraland:polygon:collections-v2:0x123:item1',
            category: 'eyewear',
            rarity: 'rare',
            name: 'Cool Glasses',
            amount: 1,
            min_transferred_at: 1640995200,
            max_transferred_at: 1640995200,
            individual_data: []
          }
        ]
        mockCountRow = { total: '1' }
      })

      it('should apply name filter using ILIKE', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

        await userAssetsComponent.getGroupedWearablesByOwner('0xowner', { first: 10, skip: 0, name: 'Cool' })

        expect(mockClient.query).toHaveBeenCalledTimes(2)
        const sqlQuery = mockClient.query.mock.calls[0][0]
        expect(sqlQuery.text).toContain('ILIKE')
        expect(sqlQuery.values).toContain('%Cool%')
      })
    })

    describe('when filtering grouped wearables by itemType', () => {
      let mockGroupedDataRows: any[]
      let mockCountRow: any

      beforeEach(() => {
        mockGroupedDataRows = [
          {
            urn: 'urn:decentraland:polygon:collections-v2:0x123:item1',
            category: 'eyewear',
            rarity: 'rare',
            name: 'Test Item',
            amount: 1,
            min_transferred_at: 1640995200,
            max_transferred_at: 1640995200,
            individual_data: []
          }
        ]
        mockCountRow = { total: '1' }
      })

      it('should apply single itemType filter (as array)', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

        await userAssetsComponent.getGroupedWearablesByOwner('0xowner', { first: 10, skip: 0, itemType: ['smart_wearable_v1'] })

        expect(mockClient.query).toHaveBeenCalledTimes(2)
        const sqlQuery = mockClient.query.mock.calls[0][0]
        expect(sqlQuery.text).toContain('item_type IN')
        expect(sqlQuery.values).toContain('smart_wearable_v1')
      })

      it('should apply array itemType filter using IN', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

        const filters: UserAssetsFilters = {
          first: 10,
          skip: 0,
          itemType: ['wearable_v1', 'wearable_v2']
        }
        await userAssetsComponent.getGroupedWearablesByOwner('0xowner', filters)

        expect(mockClient.query).toHaveBeenCalledTimes(2)
        const sqlQuery = mockClient.query.mock.calls[0][0]
        expect(sqlQuery.text).toContain('item_type IN')
        // The array values are expanded into individual SQL parameters
        expect(sqlQuery.values).toContain('wearable_v1')
        expect(sqlQuery.values).toContain('wearable_v2')
      })

      it('should use default itemTypes when itemType is not provided', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

        await userAssetsComponent.getGroupedWearablesByOwner('0xowner', { first: 10, skip: 0 })

        expect(mockClient.query).toHaveBeenCalledTimes(2)
        const sqlQuery = mockClient.query.mock.calls[0][0]
        expect(sqlQuery.text).toContain("item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1')")
      })
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

    describe('when sorting grouped emotes', () => {
      describe('and sorting by rarity', () => {
        let mockGroupedDataRows: any[]
        let mockCountRow: any

        beforeEach(() => {
          mockGroupedDataRows = [
            {
              urn: 'urn:decentraland:polygon:collections-v2:0x123:legendary-emote',
              category: 'dance',
              rarity: 'legendary',
              name: 'Legendary Dance',
              amount: 1,
              min_transferred_at: 1640995200,
              max_transferred_at: 1640995200,
              individual_data: []
            },
            {
              urn: 'urn:decentraland:polygon:collections-v2:0x123:common-emote',
              category: 'dance',
              rarity: 'common',
              name: 'Common Dance',
              amount: 1,
              min_transferred_at: 1640995200,
              max_transferred_at: 1640995200,
              individual_data: []
            }
          ]
          mockCountRow = { total: '2' }
        })

        it('should sort by rarity in descending order by default', async () => {
          mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

          await userAssetsComponent.getGroupedEmotesByOwner('0xowner', { first: 10, skip: 0, orderBy: 'rarity' })

          expect(mockClient.query).toHaveBeenCalledTimes(2)
          const sqlQuery = mockClient.query.mock.calls[0][0]
          expect(sqlQuery.text).toContain('ORDER BY rarity_order DESC')
        })

        it('should sort by rarity in ascending order when direction is ASC', async () => {
          mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows.reverse() }).mockResolvedValueOnce({ rows: [mockCountRow] })

          await userAssetsComponent.getGroupedEmotesByOwner('0xowner', { first: 10, skip: 0, orderBy: 'rarity', direction: 'ASC' })

          expect(mockClient.query).toHaveBeenCalledTimes(2)
          const sqlQuery = mockClient.query.mock.calls[0][0]
          expect(sqlQuery.text).toContain('ORDER BY rarity_order ASC')
        })
      })

      describe('and sorting by name', () => {
        let mockGroupedDataRows: any[]
        let mockCountRow: any

        beforeEach(() => {
          mockGroupedDataRows = [
            {
              urn: 'urn:decentraland:polygon:collections-v2:0x123:emote1',
              category: 'dance',
              rarity: 'common',
              name: 'Alpha Dance',
              amount: 1,
              min_transferred_at: 1640995200,
              max_transferred_at: 1640995200,
              individual_data: []
            },
            {
              urn: 'urn:decentraland:polygon:collections-v2:0x123:emote2',
              category: 'dance',
              rarity: 'common',
              name: 'Zeta Dance',
              amount: 1,
              min_transferred_at: 1640995200,
              max_transferred_at: 1640995200,
              individual_data: []
            }
          ]
          mockCountRow = { total: '2' }
        })

        it('should sort by name in ascending order by default', async () => {
          mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

          await userAssetsComponent.getGroupedEmotesByOwner('0xowner', { first: 10, skip: 0, orderBy: 'name' })

          expect(mockClient.query).toHaveBeenCalledTimes(2)
          const sqlQuery = mockClient.query.mock.calls[0][0]
          expect(sqlQuery.text).toContain('ORDER BY name ASC')
        })

        it('should sort by name in descending order when direction is DESC', async () => {
          mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows.reverse() }).mockResolvedValueOnce({ rows: [mockCountRow] })

          await userAssetsComponent.getGroupedEmotesByOwner('0xowner', { first: 10, skip: 0, orderBy: 'name', direction: 'DESC' })

          expect(mockClient.query).toHaveBeenCalledTimes(2)
          const sqlQuery = mockClient.query.mock.calls[0][0]
          expect(sqlQuery.text).toContain('ORDER BY name DESC')
        })
      })

      describe('and sorting by date', () => {
        let mockGroupedDataRows: any[]
        let mockCountRow: any

        beforeEach(() => {
          mockGroupedDataRows = [
            {
              urn: 'urn:decentraland:polygon:collections-v2:0x123:newest-emote',
              category: 'dance',
              rarity: 'common',
              name: 'Newest Dance',
              amount: 1,
              min_transferred_at: 1641081600,
              max_transferred_at: 1641081600,
              individual_data: []
            },
            {
              urn: 'urn:decentraland:polygon:collections-v2:0x123:oldest-emote',
              category: 'dance',
              rarity: 'common',
              name: 'Oldest Dance',
              amount: 1,
              min_transferred_at: 1640995200,
              max_transferred_at: 1640995200,
              individual_data: []
            }
          ]
          mockCountRow = { total: '2' }
        })

        it('should sort by date in descending order by default using max_transferred_at', async () => {
          mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

          await userAssetsComponent.getGroupedEmotesByOwner('0xowner', { first: 10, skip: 0, orderBy: 'date' })

          expect(mockClient.query).toHaveBeenCalledTimes(2)
          const sqlQuery = mockClient.query.mock.calls[0][0]
          expect(sqlQuery.text).toContain('ORDER BY max_transferred_at DESC')
        })

        it('should sort by date in ascending order using min_transferred_at when direction is ASC', async () => {
          mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows.reverse() }).mockResolvedValueOnce({ rows: [mockCountRow] })

          await userAssetsComponent.getGroupedEmotesByOwner('0xowner', { first: 10, skip: 0, orderBy: 'date', direction: 'ASC' })

          expect(mockClient.query).toHaveBeenCalledTimes(2)
          const sqlQuery = mockClient.query.mock.calls[0][0]
          expect(sqlQuery.text).toContain('ORDER BY min_transferred_at ASC')
        })
      })

      describe('and no orderBy is provided', () => {
        let mockGroupedDataRows: any[]
        let mockCountRow: any

        beforeEach(() => {
          mockGroupedDataRows = [
            {
              urn: 'urn:decentraland:polygon:collections-v2:0x123:emote1',
              category: 'dance',
              rarity: 'mythic',
              name: 'Test Emote',
              amount: 1,
              min_transferred_at: 1640995200,
              max_transferred_at: 1640995200,
              individual_data: []
            }
          ]
          mockCountRow = { total: '1' }
        })

        it('should default to sorting by rarity in descending order', async () => {
          mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

          await userAssetsComponent.getGroupedEmotesByOwner('0xowner', { first: 10, skip: 0 })

          expect(mockClient.query).toHaveBeenCalledTimes(2)
          const sqlQuery = mockClient.query.mock.calls[0][0]
          expect(sqlQuery.text).toContain('ORDER BY rarity_order DESC')
        })
      })
    })

    describe('when filtering grouped emotes by name', () => {
      let mockGroupedDataRows: any[]
      let mockCountRow: any

      beforeEach(() => {
        mockGroupedDataRows = [
          {
            urn: 'urn:decentraland:polygon:collections-v2:0x123:emote1',
            category: 'dance',
            rarity: 'rare',
            name: 'Cool Dance',
            amount: 1,
            min_transferred_at: 1640995200,
            max_transferred_at: 1640995200,
            individual_data: []
          }
        ]
        mockCountRow = { total: '1' }
      })

      it('should apply name filter using ILIKE', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: mockGroupedDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

        await userAssetsComponent.getGroupedEmotesByOwner('0xowner', { first: 10, skip: 0, name: 'Cool' })

        expect(mockClient.query).toHaveBeenCalledTimes(2)
        const sqlQuery = mockClient.query.mock.calls[0][0]
        expect(sqlQuery.text).toContain('ILIKE')
        expect(sqlQuery.values).toContain('%Cool%')
      })
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
