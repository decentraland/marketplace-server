import { IPgComponent } from '../../src/ports/db/types'
import { createIndexedHeads, createIndexedHeights, INDEXED_HEIGHT_TTL_MS } from '../../src/ports/historical'
import { getIndexedHeightQuery } from '../../src/ports/historical/queries'
import { createTestPgComponent } from '../components'

let pgQueryMock: jest.Mock
let dappsDatabase: IPgComponent
let clock: number
let getIndexedHeight: ReturnType<typeof createIndexedHeights>

beforeEach(() => {
  clock = 1000000
  pgQueryMock = jest.fn()
  dappsDatabase = createTestPgComponent({ query: pgQueryMock })
  getIndexedHeight = createIndexedHeights(dappsDatabase, () => clock)
})

describe('when reading how far a squid has indexed', () => {
  beforeEach(() => {
    pgQueryMock.mockImplementation(async (query: { text: string; values: unknown[] }) =>
      query.text.includes('public.squids')
        ? { rows: [{ schema: 'marketplace_squid_20260101_000000' }] }
        : { rows: [{ height: '20000123' }] }
    )
  })

  it("should read the height of its live deployment's Ethereum processor", async () => {
    await expect(getIndexedHeight('marketplace')).resolves.toBe(20000123)

    expect(pgQueryMock.mock.calls[0][0].values).toEqual(['marketplace'])
    expect(pgQueryMock.mock.calls[1][0].text).toContain('"eth_processor_marketplace_squid_20260101_000000".status')
    expect(pgQueryMock.mock.calls[1][0].text).toContain('"eth_processor_marketplace_squid_20260101_000000".hot_block')
  })

  it("should name registry-squid's processor state as registry-squid does", async () => {
    await getIndexedHeight('registry')

    expect(pgQueryMock.mock.calls[1][0].text).toContain('"ethereum_processor_marketplace_squid_20260101_000000".status')
  })

  it("should read registry-squid's Polygon processor for Polygon", async () => {
    await getIndexedHeight('registry', 'polygon')

    expect(pgQueryMock.mock.calls[1][0].text).toContain('"polygon_processor_marketplace_squid_20260101_000000".status')
  })

  it('should read only the finalized height when asked, from the status alone', async () => {
    await getIndexedHeight('registry', 'polygon', true)

    expect(pgQueryMock.mock.calls[1][0].text).toContain('"polygon_processor_marketplace_squid_20260101_000000".status')
    expect(pgQueryMock.mock.calls[1][0].text).not.toContain('hot_block')
  })

  it('should keep each chain, and the finalized height, apart', async () => {
    await getIndexedHeight('registry')
    await getIndexedHeight('registry', 'polygon')
    await getIndexedHeight('registry', 'polygon', true)

    expect(pgQueryMock).toHaveBeenCalledTimes(6)
  })

  it("should read marketplace-squid-core's Polygon processor for Polygon", async () => {
    await getIndexedHeight('marketplace', 'polygon')

    expect(pgQueryMock.mock.calls[1][0].text).toContain('"polygon_processor_marketplace_squid_20260101_000000".status')
  })

  it('should keep the height for a few seconds', async () => {
    await getIndexedHeight('marketplace')
    clock += INDEXED_HEIGHT_TTL_MS - 1
    await getIndexedHeight('marketplace')
    clock += 2
    await getIndexedHeight('marketplace')

    expect(pgQueryMock).toHaveBeenCalledTimes(4)
  })
})

describe('when the squid has no live deployment', () => {
  beforeEach(() => {
    pgQueryMock.mockResolvedValue({ rows: [] })
  })

  it('should fail, and try again next time', async () => {
    await expect(getIndexedHeight('registry')).rejects.toThrow('there is no live registry squid')
    await expect(getIndexedHeight('registry')).rejects.toThrow('there is no live registry squid')
    expect(pgQueryMock).toHaveBeenCalledTimes(2)
  })
})

describe('when the processor has not indexed anything yet', () => {
  beforeEach(() => {
    pgQueryMock.mockImplementation(async (query: { text: string }) =>
      query.text.includes('public.squids') ? { rows: [{ schema: 'registry_squid_20260101_000000' }] } : { rows: [{ height: null }] }
    )
  })

  it('should fail', async () => {
    await expect(getIndexedHeight('registry')).rejects.toThrow('has not indexed any block yet')
  })
})

describe('getIndexedHeightQuery', () => {
  it('should refuse a schema name that is not a plain identifier', () => {
    expect(() => getIndexedHeightQuery('eth_processor_x"; DROP TABLE y; --')).toThrow('Unexpected state schema name')
  })
})

describe("when reading a squid's indexed head", () => {
  let getBlockTimestamp: jest.Mock
  let getIndexedHead: ReturnType<typeof createIndexedHeads>

  beforeEach(() => {
    getBlockTimestamp = jest.fn()
    getIndexedHead = createIndexedHeads(dappsDatabase, getBlockTimestamp, () => clock)
    pgQueryMock.mockImplementation(async (query: { text: string; values: unknown[] }) =>
      query.text.includes('public.squids')
        ? { rows: [{ schema: 'registry_squid_20260101_000000' }] }
        : { rows: [{ height: '75000000', hash: '0xabc' }] }
    )
  })

  describe('and the chain knows the block', () => {
    beforeEach(() => {
      getBlockTimestamp.mockResolvedValueOnce(1700000000)
    })

    it("should read the highest block of the chain's processor, hot or finalized, with its hash and timestamp", async () => {
      await expect(getIndexedHead('registry', 'polygon')).resolves.toEqual({
        number: 75000000,
        hash: '0xabc',
        timestamp: 1700000000
      })
      expect(pgQueryMock.mock.calls[1][0].text).toContain('"polygon_processor_registry_squid_20260101_000000".hot_block')
      expect(pgQueryMock.mock.calls[1][0].text).toContain('"polygon_processor_registry_squid_20260101_000000".status')
      expect(getBlockTimestamp).toHaveBeenCalledWith('polygon', 75000000)
    })

    it('should keep the head for a few seconds', async () => {
      await getIndexedHead('registry', 'polygon')
      clock += INDEXED_HEIGHT_TTL_MS - 1
      await getIndexedHead('registry', 'polygon')

      expect(pgQueryMock).toHaveBeenCalledTimes(2)
    })
  })

  describe("and the chain's RPC does not answer", () => {
    beforeEach(() => {
      getBlockTimestamp.mockRejectedValueOnce(new Error('timeout'))
    })

    it('should answer the head without its timestamp', async () => {
      await expect(getIndexedHead('registry', 'ethereum')).resolves.toEqual({ number: 75000000, hash: '0xabc', timestamp: null })
    })
  })

  describe('and the processor has not indexed any block', () => {
    beforeEach(() => {
      pgQueryMock.mockImplementation(async (query: { text: string }) =>
        query.text.includes('public.squids') ? { rows: [{ schema: 'registry_squid_20260101_000000' }] } : { rows: [] }
      )
    })

    it('should fail', async () => {
      await expect(getIndexedHead('registry', 'ethereum')).rejects.toThrow('has not indexed any block yet on ethereum')
    })
  })
})
