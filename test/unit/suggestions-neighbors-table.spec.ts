import { swapNeighborsTable, type NeighborsMeta, type QueryableClient } from '../../src/logic/suggestions/neighbors-table'

type Recorded = { sql: string; values?: unknown[] }

describe('when swapping the neighbours table', () => {
  let client: QueryableClient
  let recorded: Recorded[]
  let meta: NeighborsMeta
  let rows: Array<{ itemId: string; source: string; neighborId: string; sim: number; support: number; rank: number }>
  let lockAcquired: boolean

  beforeEach(() => {
    recorded = []
    lockAcquired = true
    meta = { cfRows: 1, contentRows: 1, itemsCovered: 2, durationMs: 1234 }
    rows = [
      { itemId: '0xa-1', source: 'cf', neighborId: '0xb-2', sim: 0.5, support: 7, rank: 0 },
      { itemId: '0xa-1', source: 'content', neighborId: '0xc-3', sim: 0.35, support: 0, rank: 0 }
    ]
    client = {
      query: jest.fn(async (sql: string, values?: unknown[]) => {
        recorded.push({ sql, values })
        if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: lockAcquired }] }
        return { rows: [] }
      })
    }
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('and the advisory lock is acquired', () => {
    let outcome: string

    beforeEach(async () => {
      outcome = await swapNeighborsTable(client, rows, meta)
    })

    it('should report that it rebuilt the table', () => {
      expect(outcome).toBe('rebuilt')
    })

    it('should take the lock before touching any table', () => {
      const lockIndex = recorded.findIndex(entry => entry.sql.includes('pg_try_advisory_xact_lock'))
      const firstDdlIndex = recorded.findIndex(entry => entry.sql.includes('DROP TABLE'))
      expect(lockIndex).toBeLessThan(firstDdlIndex)
    })

    it('should build into a staging table rather than the live one', () => {
      const insert = recorded.find(entry => entry.sql.includes('INSERT INTO') && entry.sql.includes('VALUES ($1'))
      expect(insert?.sql).toContain('item_neighbors_staging')
    })

    it('should pass every row as a bound parameter rather than interpolating ids into SQL', () => {
      const insert = recorded.find(entry => entry.sql.includes('item_neighbors_staging') && entry.sql.includes('VALUES ($1'))
      expect(insert?.values).toHaveLength(rows.length * 6)
    })

    it('should rename staging onto the live name only after the data is in', () => {
      const insertIndex = recorded.findIndex(entry => entry.sql.includes('VALUES ($1'))
      const renameIndex = recorded.findIndex(entry => entry.sql.includes('RENAME TO item_neighbors'))
      expect(insertIndex).toBeLessThan(renameIndex)
    })

    it('should record the build in the metadata row so a stalled job is visible as data', () => {
      const metaWrite = recorded.find(entry => entry.sql.includes('item_neighbors_meta'))
      expect(metaWrite?.values).toEqual([1234, 1, 1, 2, 'v1'])
    })

    it('should commit exactly once', () => {
      expect(recorded.filter(entry => entry.sql === 'COMMIT')).toHaveLength(1)
    })

    it('should never leave the swap outside a transaction', () => {
      expect(recorded[0].sql).toBe('BEGIN')
    })
  })

  describe('and another replica already holds the advisory lock', () => {
    let outcome: string

    beforeEach(async () => {
      lockAcquired = false
      outcome = await swapNeighborsTable(client, rows, meta)
    })

    it('should report that it skipped the rebuild', () => {
      expect(outcome).toBe('skipped')
    })

    it('should roll back instead of committing', () => {
      expect(recorded.map(entry => entry.sql)).toContain('ROLLBACK')
    })

    it('should not touch any table', () => {
      expect(recorded.some(entry => entry.sql.includes('item_neighbors_staging'))).toBe(false)
    })
  })

  describe('and a statement fails part way through the build', () => {
    let error: Error | undefined

    beforeEach(async () => {
      client = {
        query: jest.fn(async (sql: string, values?: unknown[]) => {
          recorded.push({ sql, values })
          if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }] }
          if (sql.includes('VALUES ($1')) throw new Error('canceling statement due to statement timeout')
          return { rows: [] }
        })
      }
      try {
        await swapNeighborsTable(client, rows, meta)
      } catch (e) {
        error = e as Error
      }
    })

    it('should roll back so the previous neighbours keep serving', () => {
      expect(recorded.map(entry => entry.sql)).toContain('ROLLBACK')
    })

    it('should never drop the live table', () => {
      expect(recorded.some(entry => entry.sql.includes('DROP TABLE IF EXISTS marketplace.item_neighbors;'))).toBe(false)
    })

    it('should propagate the failure so the job can log it', () => {
      expect(error?.message).toContain('statement timeout')
    })
  })

  describe('and there are more rows than fit in one insert', () => {
    beforeEach(async () => {
      rows = Array.from({ length: 4500 }, (_, i) => ({
        itemId: `0xa-${i}`,
        source: 'cf',
        neighborId: `0xb-${i}`,
        sim: 0.1,
        support: 3,
        rank: 0
      }))
      await swapNeighborsTable(client, rows, meta)
    })

    it('should split them into batches that stay inside the bind-parameter limit', () => {
      const inserts = recorded.filter(entry => entry.sql.includes('VALUES ($1'))
      expect(inserts.every(entry => (entry.values?.length ?? 0) <= 65535)).toBe(true)
    })

    it('should still insert every row', () => {
      const inserts = recorded.filter(entry => entry.sql.includes('VALUES ($1'))
      const total = inserts.reduce((sum, entry) => sum + (entry.values?.length ?? 0) / 6, 0)
      expect(total).toBe(4500)
    })
  })
})
