import { IPgComponent } from '../../src/ports/db/types'
import {
  BlockTooRecentError,
  createBlockTimestamps,
  createHistoricalComponent,
  createIndexedBlockTimestamps,
  HistoricalBusyError,
  HistoricalUnavailableError,
  IHistoricalComponent,
  MAX_RESULT_AGE_MS,
  MAX_RUNNING_READS,
  MAX_WAITING_READS,
  MIN_BLOCK_AGE_SECONDS,
  SquidStateNotFoundError,
  THIRD_PARTY_REVIEWS_TTL_MS
} from '../../src/ports/historical'
import { createTestPgComponent } from '../components'

const BLOCK = 20000000
const BLOCK_TIMESTAMP = 1700000000
const NOW = (BLOCK_TIMESTAMP + 3600) * 1000

const LAND = '0xf87e31492faf9a91b02ee0deaad50d51d56d5d4d'
const ESTATE = '0x959e104e1a4db6317fa58f8295f586e1a978c297'
const ALICE = '0x0000000000000000000000000000000000000a11'
const BOB = '0x0000000000000000000000000000000000000b0b'

let pgQueryMock: jest.Mock
let getBlockTimestamp: jest.Mock
let getIndexedHeight: jest.Mock
let dappsDatabase: IPgComponent
let historical: IHistoricalComponent
let clock: number

const nftsFilters = { block: BLOCK, owners: [ALICE], first: 100, skip: 0 }

/** Lets the reads already started reach the database. */
const settle = () => new Promise(resolve => setImmediate(resolve))

const ownerQueries = () => pgQueryMock.mock.calls.filter(([query]) => !query.text.includes('estate_history'))

beforeEach(() => {
  pgQueryMock = jest.fn()
  getBlockTimestamp = jest.fn().mockResolvedValue(BLOCK_TIMESTAMP)
  getIndexedHeight = jest.fn().mockResolvedValue(BLOCK + 1000)
  dappsDatabase = createTestPgComponent({ query: pgQueryMock })
  clock = NOW
  historical = createHistoricalComponent({ dappsDatabase, getBlockTimestamp, getIndexedHeight, now: () => clock })
})

afterEach(() => {
  jest.resetAllMocks()
})

describe('when the chain has not reached the block yet', () => {
  beforeEach(() => {
    getBlockTimestamp.mockResolvedValue(undefined)
  })

  it('should reject with a block too recent error without querying the database', async () => {
    await expect(historical.getNfts(nftsFilters)).rejects.toBeInstanceOf(BlockTooRecentError)
    expect(pgQueryMock).not.toHaveBeenCalled()
  })

  it('should not ask the chain about the block again right away', async () => {
    await expect(historical.getNfts(nftsFilters)).rejects.toBeInstanceOf(BlockTooRecentError)
    await expect(historical.getEstates({ block: BLOCK, tokenIds: ['1'], first: 100, skip: 0 })).rejects.toBeInstanceOf(BlockTooRecentError)
    expect(getBlockTimestamp).toHaveBeenCalledTimes(1)
  })
})

describe('when the block is younger than the minimum age', () => {
  beforeEach(() => {
    historical = createHistoricalComponent({
      dappsDatabase,
      getBlockTimestamp,
      getIndexedHeight,
      now: () => (BLOCK_TIMESTAMP + MIN_BLOCK_AGE_SECONDS - 1) * 1000
    })
  })

  it('should reject with a block too recent error', async () => {
    await expect(historical.getEstates({ block: BLOCK, tokenIds: ['1'], first: 100, skip: 0 })).rejects.toBeInstanceOf(BlockTooRecentError)
  })
})

describe('when getting the NFTs held at a block', () => {
  beforeEach(() => {
    pgQueryMock.mockImplementation(async (query: { text: string }) => {
      if (query.text.includes('estate_history')) {
        return { rows: [{ estate_token_id: '7', size: 3 }] }
      }
      return {
        rows: [
          { contract_address: LAND, token_id: '20', category: 'parcel', item_type: null, search_wearable_rarity: null, owner: ALICE },
          { contract_address: ESTATE, token_id: '7', category: 'estate', item_type: null, search_wearable_rarity: null, owner: ALICE },
          { contract_address: ESTATE, token_id: '8', category: 'estate', item_type: null, search_wearable_rarity: null, owner: ALICE },
          { contract_address: LAND, token_id: '10', category: 'parcel', item_type: null, search_wearable_rarity: null, owner: BOB }
        ]
      }
    })
  })

  it('should return only the NFTs the owners held, ordered by id, with the estates sized at the block', async () => {
    const nfts = await historical.getNfts({ ...nftsFilters, owners: [ALICE.toUpperCase().replace('0X', '0x')] })

    expect(nfts).toEqual([
      {
        contractAddress: ESTATE,
        tokenId: '7',
        category: 'estate',
        owner: ALICE,
        itemType: null,
        searchWearableRarity: null,
        searchEstateSize: 3
      },
      {
        contractAddress: ESTATE,
        tokenId: '8',
        category: 'estate',
        owner: ALICE,
        itemType: null,
        searchWearableRarity: null,
        searchEstateSize: 0
      },
      {
        contractAddress: LAND,
        tokenId: '20',
        category: 'parcel',
        owner: ALICE,
        itemType: null,
        searchWearableRarity: null,
        searchEstateSize: null
      }
    ])
  })

  it('should leave out the estates not above the size asked for', async () => {
    const nfts = await historical.getNfts({ ...nftsFilters, estateSizeGt: 0 })

    expect(nfts.map(nft => nft.tokenId)).toEqual(['7'])
  })

  it('should start after the id asked for and page the rest', async () => {
    const nfts = await historical.getNfts({ ...nftsFilters, idGt: `${ESTATE}-7`, first: 1, skip: 1 })

    expect(nfts.map(nft => nft.tokenId)).toEqual(['20'])
  })

  it('should compare the id to start after in lowercase, as the subgraphs ids are', async () => {
    const nfts = await historical.getNfts({ ...nftsFilters, idGt: `${ESTATE.toUpperCase().replace('0X', '0x')}-7` })

    expect(nfts.map(nft => nft.tokenId)).toEqual(['8', '20'])
  })

  it('should read the same target once, whatever the order, case and repeats of its values', async () => {
    await historical.getNfts({ ...nftsFilters, contractAddresses: [LAND, ESTATE], itemTypes: ['wearable_v1', 'emote_v1'] })
    await historical.getNfts({
      ...nftsFilters,
      contractAddresses: [ESTATE.toUpperCase().replace('0X', '0x'), LAND, LAND],
      itemTypes: ['emote_v1', 'wearable_v1']
    })

    expect(ownerQueries()).toHaveLength(1)
  })

  it('should read the owners once per block and target, however many requests ask', async () => {
    await Promise.all([historical.getNfts(nftsFilters), historical.getNfts({ ...nftsFilters, owners: [BOB] })])
    await historical.getNfts(nftsFilters)

    expect(ownerQueries()).toHaveLength(1)
    expect(getBlockTimestamp).toHaveBeenCalledTimes(1)
  })

  it('should read the owners again for another target', async () => {
    await historical.getNfts(nftsFilters)
    await historical.getNfts({ ...nftsFilters, category: 'estate' })

    expect(ownerQueries()).toHaveLength(2)
  })
})

describe('when a result has been kept for long', () => {
  let clock: number

  beforeEach(() => {
    clock = NOW
    historical = createHistoricalComponent({ dappsDatabase, getBlockTimestamp, getIndexedHeight, now: () => clock })
    pgQueryMock.mockResolvedValue({ rows: [] })
  })

  it('should read it again, in case a squid was behind the first time', async () => {
    await historical.getNfts(nftsFilters)
    clock += MAX_RESULT_AGE_MS / 2
    await historical.getNfts(nftsFilters)
    clock += MAX_RESULT_AGE_MS
    await historical.getNfts(nftsFilters)

    expect(ownerQueries()).toHaveLength(2)
  })
})

describe('when reading the owners fails', () => {
  beforeEach(() => {
    pgQueryMock.mockRejectedValueOnce(new Error('connection reset')).mockResolvedValue({ rows: [] })
  })

  it('should not keep the failure for the next request', async () => {
    await expect(historical.getNfts(nftsFilters)).rejects.toThrow('connection reset')
    await expect(historical.getNfts(nftsFilters)).resolves.toEqual([])
    expect(pgQueryMock).toHaveBeenCalledTimes(2)
  })
})

describe('when getting the estates at a block', () => {
  beforeEach(() => {
    pgQueryMock.mockResolvedValue({
      rows: [
        { estate_token_id: '7', size: 3 },
        { estate_token_id: '12', size: 0 },
        { estate_token_id: '9', size: '5' }
      ]
    })
  })

  it('should return the sizes of the estates asked for that existed, ordered by id', async () => {
    const estates = await historical.getEstates({ block: BLOCK, tokenIds: ['9', '7', '12', '404', '7'], first: 100, skip: 0 })

    expect(estates).toEqual([
      { tokenId: '12', size: 0 },
      { tokenId: '7', size: 3 },
      { tokenId: '9', size: 5 }
    ])
  })

  it('should leave out the estates not above the size asked for', async () => {
    const estates = await historical.getEstates({ block: BLOCK, tokenIds: ['7', '9', '12'], sizeGt: 3, first: 100, skip: 0 })

    expect(estates).toEqual([{ tokenId: '9', size: 5 }])
  })
})

describe('when getting the assets in the Rentals contract at a block', () => {
  beforeEach(() => {
    pgQueryMock.mockResolvedValue({
      rows: [
        // Claimed back before the block.
        { contract_address: LAND, token_id: '1', lessor: ALICE, claimed_at: String(BLOCK_TIMESTAMP - 10) },
        // Claimed back after the block: still in the contract at the block.
        { contract_address: LAND, token_id: '2', lessor: ALICE, claimed_at: String(BLOCK_TIMESTAMP + 10) },
        { contract_address: ESTATE, token_id: '3', lessor: ALICE, claimed_at: null },
        // Claimed back in the block itself.
        { contract_address: LAND, token_id: '5', lessor: ALICE, claimed_at: String(BLOCK_TIMESTAMP) },
        { contract_address: LAND, token_id: '4', lessor: BOB, claimed_at: null }
      ]
    })
  })

  it("should return the lessors' assets that were not claimed back by the block", async () => {
    const assets = await historical.getRentalAssets({ block: BLOCK, lessors: [ALICE], first: 100, skip: 0 })

    expect(assets).toEqual([
      { contractAddress: ESTATE, tokenId: '3', lessor: ALICE, isClaimed: false },
      { contractAddress: LAND, tokenId: '2', lessor: ALICE, isClaimed: false }
    ])
  })

  it('should leave out the assets of other contracts', async () => {
    const assets = await historical.getRentalAssets({
      block: BLOCK,
      lessors: [ALICE, BOB],
      contractAddresses: [LAND],
      isClaimed: false,
      first: 100,
      skip: 0
    })

    expect(assets.map(asset => asset.tokenId)).toEqual(['2', '4'])
  })
})

describe('when the cached results hold more rows than are kept', () => {
  beforeEach(() => {
    historical = createHistoricalComponent({ dappsDatabase, getBlockTimestamp, getIndexedHeight, now: () => NOW, maxCachedRows: 2 })
    pgQueryMock.mockResolvedValue({
      rows: [{ contract_address: LAND, token_id: '1', category: 'parcel', item_type: null, search_wearable_rarity: null, owner: ALICE }]
    })
  })

  it('should drop the least recently used', async () => {
    await historical.getNfts({ ...nftsFilters, category: 'parcel' })
    await historical.getNfts({ ...nftsFilters, category: 'wearable' })
    // Used again, so it is now the most recent.
    await historical.getNfts({ ...nftsFilters, category: 'parcel' })
    // A third result does not fit: the wearables go.
    await historical.getNfts({ ...nftsFilters, category: 'ens' })
    await historical.getNfts({ ...nftsFilters, category: 'parcel' })
    await historical.getNfts({ ...nftsFilters, category: 'wearable' })

    expect(ownerQueries().map(([query]) => query.values[0])).toEqual(['parcel', 'wearable', 'ens', 'wearable'])
  })

  it('should answer a result larger than all that is kept without keeping it', async () => {
    const row = { contract_address: LAND, category: 'parcel', item_type: null, search_wearable_rarity: null, owner: ALICE }
    pgQueryMock.mockResolvedValue({ rows: ['1', '2', '3'].map(token_id => ({ ...row, token_id })) })

    await expect(historical.getNfts({ ...nftsFilters, category: 'parcel' })).resolves.toHaveLength(3)
    await historical.getNfts({ ...nftsFilters, category: 'parcel' })

    expect(ownerQueries()).toHaveLength(2)
  })
})

describe('when more reads arrive than run at once', () => {
  let finish: (() => void)[]

  beforeEach(() => {
    finish = []
    pgQueryMock.mockImplementation(() => new Promise(resolve => finish.push(() => resolve({ rows: [] }))))
  })

  const contract = (i: number) => `0x${String(i).padStart(40, '0')}`

  it('should run the next one once a running read ends', async () => {
    const reads = [1, 2, 3].map(i => historical.getNfts({ ...nftsFilters, contractAddresses: [contract(i)] }))
    await settle()
    expect(pgQueryMock).toHaveBeenCalledTimes(MAX_RUNNING_READS)

    finish[0]()
    await settle()
    expect(pgQueryMock).toHaveBeenCalledTimes(MAX_RUNNING_READS + 1)

    finish.slice(1).forEach(done => done())
    await expect(Promise.all(reads)).resolves.toEqual([[], [], []])
  })

  it('should free the slot of a read that fails', async () => {
    pgQueryMock.mockReset()
    pgQueryMock
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValue({ rows: [] })
    const failed = [1, 2].map(i => historical.getNfts({ ...nftsFilters, contractAddresses: [contract(i)] }))
    await Promise.allSettled(failed)

    await expect(historical.getNfts({ ...nftsFilters, contractAddresses: [contract(3)] })).resolves.toEqual([])
  })

  it('should turn a read away when too many are waiting', async () => {
    for (let i = 0; i < MAX_RUNNING_READS + MAX_WAITING_READS; i++) {
      void historical.getNfts({ ...nftsFilters, contractAddresses: [contract(i)] })
    }
    await settle()

    await expect(historical.getNfts({ ...nftsFilters, contractAddresses: [contract(999)] })).rejects.toBeInstanceOf(HistoricalBusyError)
  })
})

describe('when a squid has not indexed the block yet', () => {
  beforeEach(() => {
    getIndexedHeight.mockImplementation(async (squid: string) => (squid === 'registry' ? BLOCK - 1 : BLOCK + 1000))
    pgQueryMock.mockResolvedValue({
      rows: [{ contract_address: ESTATE, token_id: '7', category: 'estate', item_type: null, search_wearable_rarity: null, owner: ALICE }]
    })
  })

  it('should not read the estates, whose sizes come from that squid', async () => {
    await expect(historical.getEstates({ block: BLOCK, tokenIds: ['7'], first: 100, skip: 0 })).rejects.toThrow(
      `the registry squid has indexed up to ${BLOCK - 1}`
    )
    expect(pgQueryMock).not.toHaveBeenCalled()
  })

  it('should not answer NFTs that are estates either', async () => {
    await expect(historical.getNfts({ ...nftsFilters, category: 'estate' })).rejects.toBeInstanceOf(BlockTooRecentError)
  })

  it('should still answer what the other squid holds', async () => {
    getIndexedHeight.mockImplementation(async (squid: string) => (squid === 'marketplace' ? BLOCK - 1 : BLOCK + 1000))
    pgQueryMock.mockResolvedValue({ rows: [] })
    await expect(historical.getRentalAssets({ block: BLOCK, lessors: [ALICE], first: 100, skip: 0 })).resolves.toEqual([])
    await expect(historical.getNfts(nftsFilters)).rejects.toThrow(`the marketplace squid has indexed up to ${BLOCK - 1}`)
  })
})

describe("when a squid's height cannot be read", () => {
  beforeEach(() => {
    getIndexedHeight.mockRejectedValue(new Error('permission denied for schema'))
  })

  it('should answer that past holdings are unavailable, without reading them', async () => {
    await expect(historical.getNfts(nftsFilters)).rejects.toBeInstanceOf(HistoricalUnavailableError)
    expect(pgQueryMock).not.toHaveBeenCalled()
  })
})

describe('when the RPC fails', () => {
  beforeEach(() => {
    getBlockTimestamp.mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(BLOCK_TIMESTAMP)
    pgQueryMock.mockResolvedValue({ rows: [] })
  })

  it('should answer that past holdings are unavailable, and ask again next time', async () => {
    await expect(historical.getNfts(nftsFilters)).rejects.toBeInstanceOf(HistoricalUnavailableError)
    await expect(historical.getNfts(nftsFilters)).resolves.toEqual([])
  })
})

describe('when the filters list nobody', () => {
  it('should answer nothing without reading anything', async () => {
    await expect(historical.getNfts({ ...nftsFilters, owners: [] })).resolves.toEqual([])
    await expect(historical.getEstates({ block: BLOCK, tokenIds: [], first: 100, skip: 0 })).resolves.toEqual([])
    await expect(historical.getRentalAssets({ block: BLOCK, lessors: [], first: 100, skip: 0 })).resolves.toEqual([])
    expect(getBlockTimestamp).not.toHaveBeenCalled()
    expect(pgQueryMock).not.toHaveBeenCalled()
  })
})

describe('when getting the third parties at a Polygon block', () => {
  const POLYGON_BLOCK = 60000000
  const review = (id: string, block: number, root: string, isApproved: boolean, logIndex = 0) => ({
    third_party_id: id,
    root,
    is_approved: isApproved,
    block_number: block,
    log_index: logIndex
  })
  const filters = { block: POLYGON_BLOCK, ids: ['urn:tp:b', 'urn:tp:a', 'urn:tp:c', 'urn:tp:never'], first: 100, skip: 0 }

  beforeEach(() => {
    getIndexedHeight.mockResolvedValue(POLYGON_BLOCK + 100)
    // Ordered by third party, block and log index, as the query reads them.
    pgQueryMock.mockResolvedValue({
      rows: [
        review('urn:tp:a', POLYGON_BLOCK - 10, '0xa1', true),
        review('urn:tp:a', POLYGON_BLOCK, '0xa2', true, 3),
        review('urn:tp:a', POLYGON_BLOCK + 1, '0xa3', true),
        review('urn:tp:b', POLYGON_BLOCK - 5, '0xb1', true),
        review('urn:tp:b', POLYGON_BLOCK - 5, '0xb1', false, 7),
        review('urn:tp:c', POLYGON_BLOCK + 50, '0xc1', true)
      ]
    })
  })

  it('should answer each as its last review up to the block left it, ordered by id, leaving out the ones not reviewed by then', async () => {
    await expect(historical.getThirdParties(filters)).resolves.toEqual([
      { id: 'urn:tp:a', root: '0xa2', isApproved: true },
      { id: 'urn:tp:b', root: '0xb1', isApproved: false }
    ])
  })

  it('should leave out the ones not in the approval asked for, and page the rest', async () => {
    await expect(historical.getThirdParties({ ...filters, isApproved: false })).resolves.toEqual([
      { id: 'urn:tp:b', root: '0xb1', isApproved: false }
    ])
    await expect(historical.getThirdParties({ ...filters, skip: 1, first: 1 })).resolves.toEqual([
      { id: 'urn:tp:b', root: '0xb1', isApproved: false }
    ])
  })

  it("should check the block against registry-squid's finalized Polygon height, without the RPC", async () => {
    await historical.getThirdParties(filters)

    expect(getIndexedHeight).toHaveBeenCalledWith('registry', 'polygon', true)
    expect(getBlockTimestamp).not.toHaveBeenCalled()
  })

  it('should read the reviews once for any block and ids, until they are old', async () => {
    await historical.getThirdParties(filters)
    await historical.getThirdParties({ ...filters, block: POLYGON_BLOCK - 7, ids: ['urn:tp:b'] })
    clock += THIRD_PARTY_REVIEWS_TTL_MS - 1
    await historical.getThirdParties({ ...filters, block: POLYGON_BLOCK - 1 })
    expect(pgQueryMock).toHaveBeenCalledTimes(1)

    clock += 1
    await historical.getThirdParties(filters)
    expect(pgQueryMock).toHaveBeenCalledTimes(2)
  })

  it('should share one read among concurrent requests', async () => {
    await Promise.all([historical.getThirdParties(filters), historical.getThirdParties({ ...filters, block: POLYGON_BLOCK - 1 })])

    expect(pgQueryMock).toHaveBeenCalledTimes(1)
  })

  it('should read the reviews again for a block past the height they were read at', async () => {
    await historical.getThirdParties(filters)
    getIndexedHeight.mockResolvedValue(POLYGON_BLOCK + 500)
    await historical.getThirdParties({ ...filters, block: POLYGON_BLOCK + 200 })

    expect(pgQueryMock).toHaveBeenCalledTimes(2)
  })

  it('should not take the holdings read slots, nor be turned away by them', async () => {
    let release: () => void = () => undefined
    const blocked = new Promise<{ rows: unknown[] }>(resolve => {
      release = () => resolve({ rows: [] })
    })
    pgQueryMock.mockImplementation(async (query: { text: string }) =>
      query.text.includes('v1_third_party_root_history') ? { rows: [review('urn:tp:a', POLYGON_BLOCK, '0xa', true)] } : blocked
    )
    const holdings = Array.from({ length: MAX_RUNNING_READS + MAX_WAITING_READS }, (_, i) =>
      historical.getEstates({ block: BLOCK + i, tokenIds: ['7'], first: 100, skip: 0 })
    )
    await settle()

    await expect(historical.getThirdParties(filters)).resolves.toEqual([{ id: 'urn:tp:a', root: '0xa', isApproved: true }])
    release()
    await Promise.all(holdings)
  })

  it('should answer a block registry-squid has not finalized as too recent', async () => {
    getIndexedHeight.mockResolvedValue(POLYGON_BLOCK - 1)

    await expect(historical.getThirdParties(filters)).rejects.toThrow(`the registry squid has finalized Polygon up to ${POLYGON_BLOCK - 1}`)
  })

  it('should answer nothing for no ids, without reading anything', async () => {
    await expect(historical.getThirdParties({ ...filters, ids: [] })).resolves.toEqual([])
    expect(getIndexedHeight).not.toHaveBeenCalled()
    expect(pgQueryMock).not.toHaveBeenCalled()
  })
})

describe('when the third parties cannot be read', () => {
  const filters = { block: 60000000, ids: ['urn:tp:a'], first: 100, skip: 0 }

  it("should answer that they are unavailable when registry-squid's height does not answer", async () => {
    getIndexedHeight.mockRejectedValue(new Error('permission denied for schema'))

    await expect(historical.getThirdParties(filters)).rejects.toBeInstanceOf(HistoricalUnavailableError)
  })

  it('should answer that they are unavailable when the reviews cannot be read, and read them again next time', async () => {
    getIndexedHeight.mockResolvedValue(60000100)
    pgQueryMock.mockRejectedValueOnce(new Error('relation does not exist')).mockResolvedValue({ rows: [] })

    await expect(historical.getThirdParties(filters)).rejects.toBeInstanceOf(HistoricalUnavailableError)
    await expect(historical.getThirdParties(filters)).resolves.toEqual([])
  })
})

describe("when reading a squid's indexed head", () => {
  let getIndexedHead: jest.Mock
  let component: IHistoricalComponent

  beforeEach(() => {
    getIndexedHead = jest.fn()
    component = createHistoricalComponent({
      dappsDatabase: createTestPgComponent({ query: jest.fn() }),
      getBlockTimestamp: jest.fn(),
      getIndexedHeight: jest.fn(),
      getIndexedHead
    })
  })

  describe('and the squid answers it', () => {
    beforeEach(() => {
      getIndexedHead.mockResolvedValueOnce({ number: BLOCK, hash: '0xabc', timestamp: BLOCK_TIMESTAMP })
    })

    it('should answer it', async () => {
      await expect(component.getHead('registry', 'polygon')).resolves.toEqual({ number: BLOCK, hash: '0xabc', timestamp: BLOCK_TIMESTAMP })
    })
  })

  describe('and its state cannot be read for now', () => {
    beforeEach(() => {
      getIndexedHead.mockRejectedValueOnce(Object.assign(new Error('permission denied for schema'), { code: '42501' }))
    })

    it('should fail as worth retrying', async () => {
      await expect(component.getHead('marketplace', 'ethereum')).rejects.toBeInstanceOf(HistoricalUnavailableError)
    })
  })

  describe('and its state table does not exist', () => {
    beforeEach(() => {
      getIndexedHead.mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }))
    })

    it('should fail as not worth retrying', async () => {
      await expect(component.getHead('marketplace', 'ethereum')).rejects.not.toBeInstanceOf(HistoricalUnavailableError)
    })
  })

  describe("and its state schema's name is not one", () => {
    beforeEach(() => {
      getIndexedHead.mockRejectedValueOnce(new SquidStateNotFoundError('Unexpected state schema name'))
    })

    it('should fail as not worth retrying', async () => {
      await expect(component.getHead('marketplace', 'ethereum')).rejects.toBeInstanceOf(SquidStateNotFoundError)
    })
  })
})

describe('when reading block timestamps from a chain', () => {
  let provider: { getBlock: jest.Mock; getBlockNumber: jest.Mock }

  beforeEach(() => {
    provider = {
      getBlock: jest.fn(async (block: number) => ({ timestamp: BLOCK_TIMESTAMP + block })),
      getBlockNumber: jest.fn().mockResolvedValue(100)
    }
  })

  describe('and the block is past the head the chain reported a moment ago', () => {
    let getBlockTimestamp: (block: number) => Promise<number | undefined>

    beforeEach(async () => {
      getBlockTimestamp = createBlockTimestamps('ethereum', undefined, provider)
      await getBlockTimestamp(100)
    })

    it('should answer none for holdings, without asking for it', async () => {
      await expect(getBlockTimestamp(101)).resolves.toBeUndefined()
      expect(provider.getBlock).not.toHaveBeenCalledWith(101)
    })

    it("should read it for a squid's head, which the chain has, by its hash", async () => {
      provider.getBlock.mockResolvedValueOnce({ timestamp: BLOCK_TIMESTAMP + 101 })
      await expect(createIndexedBlockTimestamps('ethereum', undefined, provider)('0xabc')).resolves.toBe(BLOCK_TIMESTAMP + 101)
      expect(provider.getBlock).toHaveBeenLastCalledWith('0xabc')
    })
  })

  describe('and the block is negative, as a processor that has indexed nothing reports', () => {
    it('should answer none without asking, as the RPC would count it back from the latest block', async () => {
      await expect(createBlockTimestamps('ethereum', undefined, provider)(-1)).resolves.toBeUndefined()
      expect(provider.getBlock).not.toHaveBeenCalled()
    })
  })
})
