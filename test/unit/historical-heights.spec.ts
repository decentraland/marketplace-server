import { IPgComponent } from '../../src/ports/db/types'
import { createIndexedHeights, INDEXED_HEIGHT_TTL_MS } from '../../src/ports/historical'
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
