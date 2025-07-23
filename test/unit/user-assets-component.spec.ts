import { ILoggerComponent } from '@well-known-components/interfaces'
import { IPgComponent } from '../../src/ports/db/types'
import { createUserAssetsComponent } from '../../src/ports/user-assets/component'
import { IUserAssetsComponent } from '../../src/ports/user-assets/types'

describe('User Assets Component', () => {
  let userAssetsComponent: IUserAssetsComponent
  let mockLogs: ILoggerComponent
  let mockDappsDatabase: IPgComponent
  let mockLogger: {
    debug: jest.Mock
    error: jest.Mock
  }
  let mockClient: {
    query: jest.Mock
    release: jest.Mock
  }

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      error: jest.fn()
    }

    mockLogs = {
      getLogger: jest.fn().mockReturnValue(mockLogger)
    } as unknown as ILoggerComponent

    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    }

    mockDappsDatabase = {
      getPool: jest.fn().mockReturnValue({
        connect: jest.fn().mockResolvedValue(mockClient)
      })
    } as unknown as IPgComponent
  })

  describe('when fetching user wearables', () => {
    beforeEach(async () => {
      userAssetsComponent = await createUserAssetsComponent({
        logs: mockLogs,
        dappsDatabase: mockDappsDatabase
      })
    })

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

      mockClient.query.mockResolvedValueOnce({ rows: mockDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

      const result = await userAssetsComponent.getWearablesByOwner('0xowner', 10, 20)

      expect(result).toEqual({
        data: expect.any(Array),
        total: 50
      })
      expect(mockClient.query).toHaveBeenCalledTimes(2)
      expect(mockClient.release).toHaveBeenCalledTimes(1)
      expect(mockLogger.debug).toHaveBeenCalled()
    })

    it('should handle database errors', async () => {
      mockClient.query.mockRejectedValue(new Error('Database error'))

      await expect(userAssetsComponent.getWearablesByOwner('0xowner', 10, 0)).rejects.toThrow('Database error')

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error fetching wearables by owner',
        expect.objectContaining({
          owner: '0xowner',
          error: 'Database error'
        })
      )
      expect(mockClient.release).toHaveBeenCalledTimes(1)
    })

    it('should use default pagination values', async () => {
      const mockDataRows: unknown[] = []
      const mockCountRow = { total: '0' }

      mockClient.query.mockResolvedValueOnce({ rows: mockDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

      const result = await userAssetsComponent.getWearablesByOwner('0xowner')

      expect(result).toEqual({
        data: [],
        total: 0
      })
      expect(mockClient.query).toHaveBeenCalledTimes(2)
    })
  })

  describe('when fetching minimal wearable data', () => {
    beforeEach(async () => {
      userAssetsComponent = await createUserAssetsComponent({
        logs: mockLogs,
        dappsDatabase: mockDappsDatabase
      })
    })

    it('should fetch minimal wearable data with pagination', async () => {
      const mockDataRows = [
        { urn: 'urn:decentraland:polygon:collections-v2:0x123:1', token_id: '1' },
        { urn: 'urn:decentraland:polygon:collections-v2:0x123:2', token_id: '2' }
      ]
      const mockCountRow = { total: '25' }

      mockClient.query.mockResolvedValueOnce({ rows: mockDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

      const result = await userAssetsComponent.getOwnedWearablesUrnAndTokenId('0xowner', 10, 0)

      expect(result).toEqual({
        data: [
          { urn: 'urn:decentraland:polygon:collections-v2:0x123:1', tokenId: '1' },
          { urn: 'urn:decentraland:polygon:collections-v2:0x123:2', tokenId: '2' }
        ],
        total: 25
      })
      expect(mockClient.query).toHaveBeenCalledTimes(2)
    })
  })

  describe('when fetching user emotes', () => {
    beforeEach(async () => {
      userAssetsComponent = await createUserAssetsComponent({
        logs: mockLogs,
        dappsDatabase: mockDappsDatabase
      })
    })

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

      mockClient.query.mockResolvedValueOnce({ rows: mockDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

      const result = await userAssetsComponent.getEmotesByOwner('0xowner', 5, 10)

      expect(result).toEqual({
        data: expect.any(Array),
        total: 30
      })
      expect(mockClient.query).toHaveBeenCalledTimes(2)
    })
  })

  describe('when fetching user names', () => {
    beforeEach(async () => {
      userAssetsComponent = await createUserAssetsComponent({
        logs: mockLogs,
        dappsDatabase: mockDappsDatabase
      })
    })

    it('should fetch names with pagination', async () => {
      const mockDataRows = [
        {
          id: '1',
          contract_address: '0x123',
          token_id: '1',
          name: 'coolname',
          created_at: '2023-01-01',
          price: 50
        }
      ]
      const mockCountRow = { total: '15' }

      mockClient.query.mockResolvedValueOnce({ rows: mockDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

      const result = await userAssetsComponent.getNamesByOwner('0xowner', 5, 5)

      expect(result).toEqual({
        data: expect.any(Array),
        total: 15
      })
      expect(mockClient.query).toHaveBeenCalledTimes(2)
    })
  })

  describe('when fetching minimal names data', () => {
    beforeEach(async () => {
      userAssetsComponent = await createUserAssetsComponent({
        logs: mockLogs,
        dappsDatabase: mockDappsDatabase
      })
    })

    it('should fetch minimal names data with pagination', async () => {
      const mockDataRows = [{ name: 'coolname' }, { name: 'anothername' }]
      const mockCountRow = { total: '10' }

      mockClient.query.mockResolvedValueOnce({ rows: mockDataRows }).mockResolvedValueOnce({ rows: [mockCountRow] })

      const result = await userAssetsComponent.getOwnedNamesOnly('0xowner', 10, 0)

      expect(result).toEqual({
        data: [{ name: 'coolname' }, { name: 'anothername' }],
        total: 10
      })
      expect(mockClient.query).toHaveBeenCalledTimes(2)
    })
  })
})
