import { flushTradesMaterializedViewIfDirty, TRADES_MV_NAME } from '../../src/logic/trades/materialized-view'
import { IPgComponent } from '../../src/ports/db/types'

let mockQuery: jest.Mock
let mockPg: IPgComponent

beforeEach(() => {
  mockQuery = jest.fn()
  mockPg = {
    getPool: jest.fn(),
    withTransaction: jest.fn(),
    withAsyncContextTransaction: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    streamQuery: jest.fn(),
    query: mockQuery
  } as unknown as IPgComponent
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('when flushing a debounced trades materialized view refresh', () => {
  describe('and the state row is dirty and the debounce interval has elapsed', () => {
    beforeEach(() => {
      // First call is the claim UPDATE (wins), second call is the REFRESH
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: true }] }).mockResolvedValueOnce({ rowCount: 0, rows: [] })
    })

    it('should claim the flush by clearing dirty and stamping last_refresh', async () => {
      await flushTradesMaterializedViewIfDirty(mockPg)

      const claimSql = mockQuery.mock.calls[0][0] as string
      expect(claimSql).toContain('UPDATE marketplace.mv_trades_refresh_state')
      expect(claimSql).toContain('dirty = false')
      expect(claimSql).toContain('last_refresh = clock_timestamp()')
      expect(claimSql).toContain('WHERE dirty = true')
      expect(claimSql).toContain('FOR UPDATE SKIP LOCKED')
    })

    it('should refresh the materialized view concurrently', async () => {
      await flushTradesMaterializedViewIfDirty(mockPg)

      expect(mockQuery).toHaveBeenCalledTimes(2)
      expect(mockQuery.mock.calls[1][0]).toBe(`REFRESH MATERIALIZED VIEW CONCURRENTLY marketplace.${TRADES_MV_NAME}`)
    })

    it('should return true', async () => {
      await expect(flushTradesMaterializedViewIfDirty(mockPg)).resolves.toBe(true)
    })
  })

  describe('and the state row is not dirty or the interval has not elapsed', () => {
    beforeEach(() => {
      // The claim UPDATE matches no row
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] })
    })

    it('should not refresh the materialized view', async () => {
      await flushTradesMaterializedViewIfDirty(mockPg)

      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(mockQuery.mock.calls[0][0]).not.toContain('REFRESH MATERIALIZED VIEW')
    })

    it('should return false', async () => {
      await expect(flushTradesMaterializedViewIfDirty(mockPg)).resolves.toBe(false)
    })
  })
})
