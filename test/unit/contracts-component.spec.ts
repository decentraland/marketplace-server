import { ICacheStorageComponent } from '@dcl/core-commons'
import { ChainId, Network, NFTCategory } from '@dcl/schemas'
import { createContractsComponent } from '../../src/ports/contracts/component'
import { DBCollection, IContractsComponent } from '../../src/ports/contracts/types'
import { IPgComponent } from '../../src/ports/db/types'
import { SquidNetwork } from '../../src/types'
import { createTestPgComponent } from '../components'
import { createCacheMockedComponent } from '../mocks/cache-mock'

let inMemoryCache: ICacheStorageComponent
let mockGet: jest.MockedFn<ICacheStorageComponent['get']>
let mockSet: jest.MockedFn<ICacheStorageComponent['set']>
let contractsComponent: IContractsComponent
let pgComponent: IPgComponent
let pgQueryMock: jest.Mock

jest.mock('../../src/logic/chainIds', () => ({
  getEthereumChainId: () => ChainId.ETHEREUM_SEPOLIA,
  getPolygonChainId: () => ChainId.MATIC_AMOY,
  getNetwork: (network: string) => (network === SquidNetwork.POLYGON ? Network.MATIC : Network.ETHEREUM),
  getNetworkChainId: (network: string) => (network === SquidNetwork.POLYGON ? ChainId.MATIC_AMOY : ChainId.ETHEREUM_SEPOLIA)
}))

beforeEach(() => {
  mockGet = jest.fn()
  mockSet = jest.fn()
  pgQueryMock = jest.fn()

  inMemoryCache = createCacheMockedComponent({
    get: mockGet as any,
    set: mockSet
  })

  pgComponent = createTestPgComponent({ query: pgQueryMock })
  contractsComponent = createContractsComponent({ dappsDatabase: pgComponent, inMemoryCache })
})

afterEach(() => {
  jest.resetAllMocks()
})

describe('when getting marketplace contracts', () => {
  it('should include LAND, Estates, and Names contracts', () => {
    const contracts = contractsComponent.getMarketplaceContracts()

    expect(contracts.some(c => c.name === 'LAND')).toBe(true)
    expect(contracts.some(c => c.name === 'Estates')).toBe(true)
    expect(contracts.some(c => c.name === 'Names')).toBe(true)
  })
})

describe('when getting collection contracts', () => {
  describe('and there are no collections', () => {
    beforeEach(() => {
      pgQueryMock.mockResolvedValue({ rows: [] })
    })

    it('should return empty data with 0 total', async () => {
      const result = await contractsComponent.getCollectionContracts()
      expect(result).toEqual({ data: [], total: 0 })
    })
  })

  describe('and there is a collection', () => {
    let dbCollections: DBCollection[]

    beforeEach(() => {
      dbCollections = [
        {
          id: '0x1096f950841a99f9b961434714d9a08d3d4ebdff',
          name: 'Test Collection',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON
        }
      ]
      pgQueryMock.mockResolvedValueOnce({ rows: dbCollections }).mockResolvedValueOnce({ rows: [{ count: '1' }] })
    })

    it('should return wearable contract', async () => {
      const result = await contractsComponent.getCollectionContracts()

      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toEqual({
        name: 'Test Collection',
        address: '0x1096f950841a99f9b961434714d9a08d3d4ebdff',
        category: NFTCategory.WEARABLE,
        network: Network.MATIC,
        chainId: ChainId.MATIC_AMOY
      })
      expect(result.total).toBe(1)
    })
  })
})

describe('when getting all collection contracts', () => {
  describe('and there are no contracts', () => {
    beforeEach(() => {
      pgQueryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] })
    })

    it('should return empty array and only call count query', async () => {
      const result = await contractsComponent.getAllCollectionContracts()

      expect(result).toHaveLength(0)
      expect(pgQueryMock).toHaveBeenCalledTimes(1) // Only count query
    })
  })

  describe('and there are fewer contracts than page size', () => {
    beforeEach(() => {
      const dbCollections: DBCollection[] = [
        {
          id: '0x1',
          name: 'Collection 1',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON
        }
      ]
      pgQueryMock.mockResolvedValueOnce({ rows: [{ count: '1' }] }).mockResolvedValueOnce({ rows: dbCollections })
    })

    it('should fetch count once then data in a single page', async () => {
      const result = await contractsComponent.getAllCollectionContracts()

      expect(result).toHaveLength(1)
      expect(pgQueryMock).toHaveBeenCalledTimes(2) // One count query, one data query
    })
  })

  describe('and there are more contracts than page size', () => {
    beforeEach(() => {
      // Mock first page
      const firstPageCollections: DBCollection[] = Array(500)
        .fill(null)
        .map((_, i) => ({
          id: `0x${i}`,
          name: `Collection ${i}`,
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON,
          count: 600
        }))

      // Mock second page
      const secondPageCollections: DBCollection[] = Array(100)
        .fill(null)
        .map((_, i) => ({
          id: `0x${i + 500}`,
          name: `Collection ${i + 500}`,
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON,
          count: 600
        }))

      pgQueryMock
        // Count query (once)
        .mockResolvedValueOnce({ rows: [{ count: '600' }] })
        // First page data
        .mockResolvedValueOnce({ rows: firstPageCollections })
        // Second page data
        .mockResolvedValueOnce({ rows: secondPageCollections })
    })

    it('should fetch count once then paginate through data', async () => {
      const result = await contractsComponent.getAllCollectionContracts()

      expect(result).toHaveLength(600)
      expect(pgQueryMock).toHaveBeenCalledTimes(3) // One count query + two data queries
    })
  })

  describe('and the cache is being used', () => {
    describe('and the data is already cached', () => {
      let cachedContracts: any[]

      beforeEach(() => {
        cachedContracts = [
          {
            name: 'Cached Collection',
            address: '0xcached',
            category: NFTCategory.WEARABLE,
            network: Network.MATIC,
            chainId: ChainId.MATIC_AMOY
          }
        ]
        mockGet.mockResolvedValueOnce(cachedContracts)
      })

      it('should return cached data', async () => {
        const result = await contractsComponent.getAllCollectionContracts()

        expect(result).toEqual(cachedContracts)
      })

      it('should not query the database', async () => {
        await contractsComponent.getAllCollectionContracts()

        expect(pgQueryMock).not.toHaveBeenCalled()
      })

      it('should check the cache', async () => {
        await contractsComponent.getAllCollectionContracts()

        expect(mockGet).toHaveBeenCalledWith('all_collection_contracts')
      })
    })

    describe('and the data is not cached', () => {
      let dbCollections: DBCollection[]

      beforeEach(() => {
        mockGet.mockResolvedValueOnce(undefined)
        dbCollections = [
          {
            id: '0x1',
            name: 'Fresh Collection',
            chain_id: ChainId.MATIC_AMOY,
            network: SquidNetwork.POLYGON
          }
        ]
        pgQueryMock.mockResolvedValueOnce({ rows: [{ count: '1' }] }).mockResolvedValueOnce({ rows: dbCollections })
      })

      it('should fetch data from the database', async () => {
        const result = await contractsComponent.getAllCollectionContracts()

        expect(result).toHaveLength(1)
        expect(result[0].name).toBe('Fresh Collection')
      })

      it('should query the database', async () => {
        await contractsComponent.getAllCollectionContracts()

        expect(pgQueryMock).toHaveBeenCalledTimes(2)
      })

      it('should store the result in the cache', async () => {
        await contractsComponent.getAllCollectionContracts()

        expect(mockSet).toHaveBeenCalledWith(
          'all_collection_contracts',
          expect.arrayContaining([
            expect.objectContaining({
              name: 'Fresh Collection',
              address: '0x1',
              category: NFTCategory.WEARABLE
            })
          ]),
          3600 // 1 hour in seconds
        )
      })
    })
  })
})

describe('when getting all contracts', () => {
  describe('and there are only marketplace contracts', () => {
    beforeEach(() => {
      pgQueryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] })
    })

    it('should return only marketplace contracts', async () => {
      const result = await contractsComponent.getContracts()

      expect(result.data.length).toBeGreaterThan(0)
      expect(result.total).toBe(result.data.length)
      expect(result.data.some(c => c.name === 'LAND')).toBe(true)
    })
  })

  describe('and there are collection contracts', () => {
    beforeEach(() => {
      const dbCollections: DBCollection[] = [
        {
          id: '0x1',
          name: 'Custom Collection',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON
        }
      ]
      pgQueryMock.mockResolvedValueOnce({ rows: [{ count: '1' }] }).mockResolvedValueOnce({ rows: dbCollections })
    })

    it('should merge marketplace and collection contracts', async () => {
      const result = await contractsComponent.getContracts()

      expect(result.data.some(c => c.name === 'LAND')).toBe(true)
      expect(result.data.some(c => c.name === 'Custom Collection')).toBe(true)
      expect(result.total).toBeGreaterThan(1)
    })
  })

  describe('and category filter is provided', () => {
    beforeEach(() => {
      pgQueryMock.mockResolvedValueOnce({ rows: [{ count: '0' }] })
    })

    it('should filter marketplace contracts by category', async () => {
      const result = await contractsComponent.getContracts({ category: NFTCategory.PARCEL })

      expect(result.data.every(c => c.category === NFTCategory.PARCEL)).toBe(true)
      expect(result.data.some(c => c.name === 'LAND')).toBe(true)
    })
  })

  describe('and skip filter is provided', () => {
    let dbCollections: DBCollection[]

    beforeEach(() => {
      dbCollections = [
        {
          id: '0x1',
          name: 'Collection A',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON
        },
        {
          id: '0x2',
          name: 'Collection B',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON
        },
        {
          id: '0x3',
          name: 'Collection C',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON
        }
      ]
      pgQueryMock.mockResolvedValueOnce({ rows: [{ count: '3' }] }).mockResolvedValueOnce({ rows: dbCollections })
    })

    describe('and skip is 0', () => {
      it('should return all contracts', async () => {
        const result = await contractsComponent.getContracts({ skip: 0, network: Network.MATIC })

        expect(result.data.length).toBe(dbCollections.length)
      })
    })

    describe('and skip is greater than 0', () => {
      it('should skip the specified number of contracts', async () => {
        const skipAmount = 2
        const result = await contractsComponent.getContracts({ skip: skipAmount, network: Network.MATIC })

        expect(result.data.length).toBe(dbCollections.length - skipAmount)
        expect(result.data[0].name).toBe(dbCollections[skipAmount].name)
      })
    })

    describe('and skip is greater than total contracts', () => {
      it('should return empty array', async () => {
        const result = await contractsComponent.getContracts({ skip: 1000, network: Network.MATIC })

        expect(result.data).toEqual([])
      })
    })
  })

  describe('and first filter is provided', () => {
    let dbCollections: DBCollection[]

    beforeEach(() => {
      dbCollections = [
        {
          id: '0x1',
          name: 'Collection A',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON
        },
        {
          id: '0x2',
          name: 'Collection B',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON
        },
        {
          id: '0x3',
          name: 'Collection C',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON
        },
        {
          id: '0x4',
          name: 'Collection D',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON
        },
        {
          id: '0x5',
          name: 'Collection E',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON
        }
      ]
      pgQueryMock.mockResolvedValueOnce({ rows: [{ count: '5' }] }).mockResolvedValueOnce({ rows: dbCollections })
    })

    describe('and first is 0', () => {
      it('should return all contracts', async () => {
        const result = await contractsComponent.getContracts({ first: 0, network: Network.MATIC })

        expect(result.data.length).toBe(dbCollections.length)
      })
    })

    describe('and first is greater than 0', () => {
      it('should return only the specified number of contracts', async () => {
        const firstAmount = 3
        const result = await contractsComponent.getContracts({ first: firstAmount, network: Network.MATIC })

        expect(result.data.length).toBe(firstAmount)
      })
    })

    describe('and first is greater than total contracts', () => {
      it('should return all available contracts', async () => {
        const result = await contractsComponent.getContracts({ first: 1000, network: Network.MATIC })

        expect(result.data.length).toBe(dbCollections.length)
      })
    })
  })

  describe('and both first and skip filters are provided', () => {
    let dbCollections: DBCollection[]

    beforeEach(() => {
      dbCollections = [
        {
          id: '0x1',
          name: 'Collection A',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON
        },
        {
          id: '0x2',
          name: 'Collection B',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON
        },
        {
          id: '0x3',
          name: 'Collection C',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON
        },
        {
          id: '0x4',
          name: 'Collection D',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON
        },
        {
          id: '0x5',
          name: 'Collection E',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON
        }
      ]
      pgQueryMock.mockResolvedValueOnce({ rows: [{ count: '5' }] }).mockResolvedValueOnce({ rows: dbCollections })
    })

    describe('and skip and first are within bounds', () => {
      it('should skip then limit results', async () => {
        const skipAmount = 1
        const firstAmount = 2
        const result = await contractsComponent.getContracts({ skip: skipAmount, first: firstAmount, network: Network.MATIC })

        expect(result.data.length).toBe(firstAmount)
        expect(result.data[0].name).toBe(dbCollections[skipAmount].name)
        expect(result.data[1].name).toBe(dbCollections[skipAmount + 1].name)
      })
    })

    describe('and skip plus first exceeds total', () => {
      it('should return remaining contracts after skip', async () => {
        const skipAmount = dbCollections.length - 2
        const firstAmount = 10
        const result = await contractsComponent.getContracts({ skip: skipAmount, first: firstAmount, network: Network.MATIC })

        expect(result.data.length).toBe(2)
      })
    })

    describe('and first is 0 with skip', () => {
      it('should skip but return all remaining contracts', async () => {
        const skipAmount = 2
        const result = await contractsComponent.getContracts({ skip: skipAmount, first: 0, network: Network.MATIC })

        expect(result.data.length).toBe(dbCollections.length - skipAmount)
        expect(result.data[0].name).toBe(dbCollections[skipAmount].name)
      })
    })
  })
})
