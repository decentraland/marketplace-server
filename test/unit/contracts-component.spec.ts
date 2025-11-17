import { ChainId, Contract, Network, NFTCategory } from '@dcl/schemas'
import { fromDBCollectionToContracts } from '../../src/adapters/contracts'
import { createContractsComponent } from '../../src/ports/contracts/component'
import { DBCollection, IContractsComponent } from '../../src/ports/contracts/types'
import { IPgComponent } from '../../src/ports/db/types'
import { SquidNetwork } from '../../src/types'
import { createTestPgComponent } from '../components'

jest.mock('../../src/logic/chainIds', () => ({
  getEthereumChainId: () => ChainId.ETHEREUM_SEPOLIA,
  getPolygonChainId: () => ChainId.MATIC_AMOY,
  getNetwork: (network: string) => (network === SquidNetwork.POLYGON ? Network.MATIC : Network.ETHEREUM),
  getNetworkChainId: (network: string) => (network === SquidNetwork.POLYGON ? ChainId.MATIC_AMOY : ChainId.ETHEREUM_SEPOLIA)
}))

describe('when getting marketplace contracts', () => {
  let contractsComponent: IContractsComponent
  let pgComponent: IPgComponent

  beforeEach(() => {
    pgComponent = createTestPgComponent({ query: jest.fn() })
    contractsComponent = createContractsComponent({ dappsDatabase: pgComponent })
  })

  it('should include LAND, Estates, and Names contracts', () => {
    const contracts = contractsComponent.getMarketplaceContracts()

    expect(contracts.some(c => c.name === 'LAND')).toBe(true)
    expect(contracts.some(c => c.name === 'Estates')).toBe(true)
    expect(contracts.some(c => c.name === 'Names')).toBe(true)
  })
})

describe('when getting collection contracts', () => {
  let contractsComponent: IContractsComponent
  let pgComponent: IPgComponent
  let pgQueryMock: jest.Mock

  describe('and there are no collections', () => {
    beforeEach(() => {
      pgQueryMock = jest.fn().mockResolvedValue({ rows: [] })
      pgComponent = createTestPgComponent({ query: pgQueryMock })
      contractsComponent = createContractsComponent({ dappsDatabase: pgComponent })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return empty data with 0 total', async () => {
      const result = await contractsComponent.getCollectionContracts()
      expect(result).toEqual({ data: [], total: 0 })
    })

    it('should call the database query twice in parallel', async () => {
      await contractsComponent.getCollectionContracts()
      expect(pgQueryMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('and there is a collection with wearables', () => {
    let dbCollections: DBCollection[]

    beforeEach(() => {
      dbCollections = [
        {
          id: '0x1096f950841a99f9b961434714d9a08d3d4ebdff',
          name: 'Test Collection',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON,
          item_types: ['wearable_v1', 'wearable_v2'],
          count: 1
        }
      ]
      pgQueryMock = jest.fn().mockResolvedValueOnce({ rows: dbCollections }).mockResolvedValueOnce({ rows: [{ count: '1' }] })
      pgComponent = createTestPgComponent({ query: pgQueryMock })
      contractsComponent = createContractsComponent({ dappsDatabase: pgComponent })
    })

    afterEach(() => {
      jest.resetAllMocks()
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

  describe('and there is a collection with emotes', () => {
    let dbCollections: DBCollection[]

    beforeEach(() => {
      dbCollections = [
        {
          id: '0x2096f950841a99f9b961434714d9a08d3d4ebdff',
          name: 'Emote Collection',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON,
          item_types: ['emote_v1'],
          count: 1
        }
      ]
      pgQueryMock = jest.fn().mockResolvedValueOnce({ rows: dbCollections }).mockResolvedValueOnce({ rows: [{ count: '1' }] })
      pgComponent = createTestPgComponent({ query: pgQueryMock })
      contractsComponent = createContractsComponent({ dappsDatabase: pgComponent })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return emote contract', async () => {
      const result = await contractsComponent.getCollectionContracts()

      expect(result.data).toHaveLength(1)
      expect(result.data[0].category).toBe(NFTCategory.EMOTE)
    })
  })

  describe('and there is a collection with both wearables and emotes', () => {
    let dbCollections: DBCollection[]

    beforeEach(() => {
      dbCollections = [
        {
          id: '0x3096f950841a99f9b961434714d9a08d3d4ebdff',
          name: 'Mixed Collection',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON,
          item_types: ['wearable_v1', 'emote_v1'],
          count: 1
        }
      ]
      pgQueryMock = jest.fn().mockResolvedValueOnce({ rows: dbCollections }).mockResolvedValueOnce({ rows: [{ count: '1' }] })
      pgComponent = createTestPgComponent({ query: pgQueryMock })
      contractsComponent = createContractsComponent({ dappsDatabase: pgComponent })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return both wearable and emote contracts', async () => {
      const result = await contractsComponent.getCollectionContracts()

      expect(result.data).toHaveLength(2)
      expect(result.data.some(c => c.category === NFTCategory.WEARABLE)).toBe(true)
      expect(result.data.some(c => c.category === NFTCategory.EMOTE)).toBe(true)
    })
  })
})

describe('when getting all collection contracts', () => {
  let contractsComponent: IContractsComponent
  let pgComponent: IPgComponent
  let pgQueryMock: jest.Mock

  describe('and there are fewer contracts than page size', () => {
    beforeEach(() => {
      const dbCollections: DBCollection[] = [
        {
          id: '0x1',
          name: 'Collection 1',
          chain_id: ChainId.MATIC_AMOY,
          network: SquidNetwork.POLYGON,
          item_types: ['wearable_v1'],
          count: 1
        }
      ]
      pgQueryMock = jest.fn().mockResolvedValueOnce({ rows: dbCollections }).mockResolvedValueOnce({ rows: [{ count: '1' }] })
      pgComponent = createTestPgComponent({ query: pgQueryMock })
      contractsComponent = createContractsComponent({ dappsDatabase: pgComponent })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should fetch all contracts in a single page', async () => {
      const result = await contractsComponent.getAllCollectionContracts()

      expect(result).toHaveLength(1)
      expect(pgQueryMock).toHaveBeenCalledTimes(2) // One call for data, one for count
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
          item_types: ['wearable_v1'],
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
          item_types: ['wearable_v1'],
          count: 600
        }))

      pgQueryMock = jest
        .fn()
        // First page data
        .mockResolvedValueOnce({ rows: firstPageCollections })
        // First page count
        .mockResolvedValueOnce({ rows: [{ count: '600' }] })
        // Second page data
        .mockResolvedValueOnce({ rows: secondPageCollections })
        // Second page count
        .mockResolvedValueOnce({ rows: [{ count: '600' }] })

      pgComponent = createTestPgComponent({ query: pgQueryMock })
      contractsComponent = createContractsComponent({ dappsDatabase: pgComponent })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should fetch all contracts with pagination', async () => {
      const result = await contractsComponent.getAllCollectionContracts()

      expect(result).toHaveLength(600)
      expect(pgQueryMock).toHaveBeenCalledTimes(4) // Two pages, each with data + count query
    })
  })
})

describe('when getting all contracts', () => {
  let contractsComponent: IContractsComponent
  let pgComponent: IPgComponent
  let pgQueryMock: jest.Mock

  describe('and there are only marketplace contracts', () => {
    beforeEach(() => {
      pgQueryMock = jest.fn().mockResolvedValue({ rows: [] })
      pgComponent = createTestPgComponent({ query: pgQueryMock })
      contractsComponent = createContractsComponent({ dappsDatabase: pgComponent })
    })

    afterEach(() => {
      jest.resetAllMocks()
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
          network: SquidNetwork.POLYGON,
          item_types: ['wearable_v1'],
          count: 1
        }
      ]
      pgQueryMock = jest.fn().mockResolvedValueOnce({ rows: dbCollections }).mockResolvedValueOnce({ rows: [{ count: '1' }] })
      pgComponent = createTestPgComponent({ query: pgQueryMock })
      contractsComponent = createContractsComponent({ dappsDatabase: pgComponent })
    })

    afterEach(() => {
      jest.resetAllMocks()
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
      pgQueryMock = jest.fn().mockResolvedValue({ rows: [] })
      pgComponent = createTestPgComponent({ query: pgQueryMock })
      contractsComponent = createContractsComponent({ dappsDatabase: pgComponent })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should filter marketplace contracts by category', async () => {
      const result = await contractsComponent.getContracts({ category: NFTCategory.PARCEL })

      expect(result.data.every(c => c.category === NFTCategory.PARCEL)).toBe(true)
      expect(result.data.some(c => c.name === 'LAND')).toBe(true)
    })
  })

  describe('and network filter is provided', () => {
    beforeEach(() => {
      pgQueryMock = jest.fn().mockResolvedValue({ rows: [] })
      pgComponent = createTestPgComponent({ query: pgQueryMock })
      contractsComponent = createContractsComponent({ dappsDatabase: pgComponent })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should filter marketplace contracts by network', async () => {
      const result = await contractsComponent.getContracts({ network: Network.ETHEREUM })

      expect(result.data.every(c => c.network === Network.ETHEREUM)).toBe(true)
    })
  })
})

