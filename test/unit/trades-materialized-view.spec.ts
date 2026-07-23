import { ensureTradesRefreshGate, flushTradesMaterializedViewIfDirty, TRADES_MV_NAME } from '../../src/logic/trades/materialized-view'
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

  describe('and the REFRESH fails after the claim', () => {
    beforeEach(() => {
      // claim wins, REFRESH throws, then the re-mark UPDATE runs
      mockQuery
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: true }] })
        .mockRejectedValueOnce(new Error('refresh boom'))
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
    })

    it('should re-mark the state row dirty so the next tick retries, and rethrow', async () => {
      await expect(flushTradesMaterializedViewIfDirty(mockPg)).rejects.toThrow('refresh boom')

      // 3rd query restores dirty = true (the claim had cleared it before the failed REFRESH).
      expect(mockQuery).toHaveBeenCalledTimes(3)
      const remarkSql = mockQuery.mock.calls[2][0] as string
      expect(remarkSql).toContain('UPDATE marketplace.mv_trades_refresh_state')
      expect(remarkSql).toContain('SET dirty = true')
    })
  })
})

describe('when ensuring the trades refresh gate', () => {
  let client: { query: jest.Mock; release: jest.Mock }

  beforeEach(() => {
    client = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: jest.fn() }
    ;(mockPg.getPool as jest.Mock).mockReturnValue({ connect: jest.fn().mockResolvedValue(client) })
  })

  it('applies the dirty column and the dirty-aware refresh function in its own committed transaction', async () => {
    await ensureTradesRefreshGate(mockPg)

    const sql = client.query.mock.calls.map(c => String(c[0]))
    // Runs as its own BEGIN..COMMIT so a later privilege failure in the full recreate cannot roll it back.
    expect(sql[0]).toBe('BEGIN')
    expect(sql[sql.length - 1]).toBe('COMMIT')
    // The `dirty` column is added idempotently (the app-side flush job depends on it).
    expect(sql.some(s => s.includes('ADD COLUMN IF NOT EXISTS dirty'))).toBe(true)
    // The refresh function is replaced in place (CREATE OR REPLACE, no DROP) and is dirty-aware.
    const fn = sql.find(s => s.includes('CREATE OR REPLACE FUNCTION refresh_trades_mv'))
    expect(fn).toBeDefined()
    expect(fn).toContain('SET dirty = true')
    expect(client.release).toHaveBeenCalled()
  })

  it('rolls back and rethrows if a gate statement fails, without leaking the connection', async () => {
    client.query.mockReset()
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockRejectedValueOnce(new Error('gate boom')) // first DDL statement fails

    await expect(ensureTradesRefreshGate(mockPg)).rejects.toThrow('gate boom')

    const sql = client.query.mock.calls.map(c => String(c[0]))
    expect(sql).toContain('ROLLBACK')
    expect(sql).not.toContain('COMMIT')
    expect(client.release).toHaveBeenCalled()
  })
})
