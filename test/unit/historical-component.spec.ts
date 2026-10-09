import { IPgComponent } from '../../src/ports/db/types'
import {
  BlockTooRecentError,
  createHistoricalComponent,
  HistoricalBusyError,
  IHistoricalComponent,
  MAX_RUNNING_READS,
  MAX_WAITING_READS,
  MIN_BLOCK_AGE_SECONDS
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
let dappsDatabase: IPgComponent
let historical: IHistoricalComponent

const nftsFilters = { block: BLOCK, owners: [ALICE], first: 100, skip: 0 }

/** Lets the reads already started reach the database. */
const settle = () => new Promise(resolve => setImmediate(resolve))

const ownerQueries = () => pgQueryMock.mock.calls.filter(([query]) => !query.text.includes('estate_history'))

beforeEach(() => {
  pgQueryMock = jest.fn()
  getBlockTimestamp = jest.fn().mockResolvedValue(BLOCK_TIMESTAMP)
  dappsDatabase = createTestPgComponent({ query: pgQueryMock })
  historical = createHistoricalComponent({ dappsDatabase, getBlockTimestamp, now: () => NOW })
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
    historical = createHistoricalComponent({ dappsDatabase, getBlockTimestamp, now: () => NOW, maxCachedRows: 2 })
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

  it('should turn a read away when too many are waiting', async () => {
    for (let i = 0; i < MAX_RUNNING_READS + MAX_WAITING_READS; i++) {
      void historical.getNfts({ ...nftsFilters, contractAddresses: [contract(i)] })
    }
    await settle()

    await expect(historical.getNfts({ ...nftsFilters, contractAddresses: [contract(999)] })).rejects.toBeInstanceOf(HistoricalBusyError)
  })
})
