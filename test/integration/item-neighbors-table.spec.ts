import {
  CREATE_NEIGHBORS_ITEM_INDEX,
  CREATE_NEIGHBORS_META_TABLE,
  CREATE_NEIGHBORS_TABLE,
  swapNeighborsTable
} from '../../src/logic/suggestions/neighbors-table'
import { test } from '../components'

/**
 * The only coverage the neighbours table's DDL has.
 *
 * Its unit spec drives swapNeighborsTable against a mocked pg, which proves the ORDER of the statements
 * but not that Postgres accepts them. That gap is not hypothetical: the swap originally built the staging
 * table with `LIKE ... INCLUDING DEFAULTS` and then upserted with ON CONFLICT, which the mock happily
 * accepted and real Postgres rejected, because `LIKE` does not copy the primary key. These tests run the
 * real statements against real Postgres.
 */
test('item neighbours table', function ({ components }) {
  const ROWS = [
    { itemId: '0xaaa-1', source: 'cf', neighborId: '0xbbb-2', sim: 0.5, support: 7, rank: 0 },
    { itemId: '0xaaa-1', source: 'content', neighborId: '0xccc-3', sim: 0.35, support: 0, rank: 0 }
  ]
  const META = { cfRows: 1, contentRows: 1, wornRows: 0, itemsCovered: 1, durationMs: 42 }

  /** Feeds a fixed set of rows through the producer contract the swap expects. */
  function producing(rows: typeof ROWS, meta = META) {
    return async (insert: (batch: typeof ROWS) => Promise<void>) => {
      await insert(rows)
      return meta
    }
  }

  async function withClient<T>(
    run: (client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> }) => Promise<T>
  ): Promise<T> {
    const client = await components.dappsWriteDatabase.getPool().connect()
    try {
      return await run(client as never)
    } finally {
      client.release()
    }
  }

  beforeEach(async () => {
    await withClient(async client => {
      await client.query(`${CREATE_NEIGHBORS_TABLE};`)
      await client.query(`${CREATE_NEIGHBORS_ITEM_INDEX};`)
      await client.query(`${CREATE_NEIGHBORS_META_TABLE};`)
    })
  })

  describe('when swapping a freshly computed neighbour set in', () => {
    let outcome: string

    beforeEach(async () => {
      outcome = await withClient(client => swapNeighborsTable(client, producing(ROWS)))
    })

    it('should report that it rebuilt the table', () => {
      expect(outcome).toBe('rebuilt')
    })

    it('should leave exactly the rows it was given', async () => {
      const rows = await withClient(client => client.query('SELECT count(*)::int AS n FROM marketplace.item_neighbors'))
      expect(rows.rows[0].n).toBe(ROWS.length)
    })

    it('should carry the primary key over to the live table, so a later swap can rely on it', async () => {
      const rows = await withClient(client =>
        client.query(`SELECT a.attname FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
           WHERE i.indrelid = 'marketplace.item_neighbors'::regclass AND i.indisprimary
           ORDER BY a.attnum`)
      )
      expect(rows.rows.map((row: { attname: string }) => row.attname)).toEqual(['item_id', 'source', 'neighbor_id'])
    })

    it('should record the build so a stalled job is visible as data rather than only in logs', async () => {
      const rows = await withClient(client =>
        client.query('SELECT cf_rows, content_rows, items_covered, algorithm FROM marketplace.item_neighbors_meta')
      )
      expect(rows.rows[0]).toEqual({ cf_rows: 1, content_rows: 1, items_covered: 1, algorithm: 'v1' })
    })

    describe('and the job runs again', () => {
      beforeEach(async () => {
        await withClient(client => swapNeighborsTable(client, producing(ROWS, { ...META, durationMs: 43 })))
      })

      it('should replace the previous set rather than accumulate alongside it', async () => {
        const rows = await withClient(client => client.query('SELECT count(*)::int AS n FROM marketplace.item_neighbors'))
        expect(rows.rows[0].n).toBe(ROWS.length)
      })

      it('should keep exactly one metadata row', async () => {
        const rows = await withClient(client => client.query('SELECT count(*)::int AS n FROM marketplace.item_neighbors_meta'))
        expect(rows.rows[0].n).toBe(1)
      })
    })
  })

  describe('when the generator produces a duplicate row', () => {
    let error: Error | undefined

    beforeEach(async () => {
      try {
        await withClient(client => swapNeighborsTable(client, producing([...ROWS, ROWS[0]])))
      } catch (e) {
        error = e as Error
      }
    })

    it('should fail the swap rather than silently drop it, because a duplicate is a generator bug', () => {
      expect(error).toBeDefined()
    })

    it('should leave the previous table in place for the endpoint to keep serving', async () => {
      const rows = await withClient(client =>
        client.query(
          `SELECT count(*)::int AS n FROM information_schema.tables
            WHERE table_schema = 'marketplace' AND table_name = 'item_neighbors'`
        )
      )
      expect(rows.rows[0].n).toBe(1)
    })
  })

  describe('when the producer aborts part-way through, as it does on a lost connection', () => {
    let error: Error | undefined
    let rowsBefore: number

    beforeEach(async () => {
      // A first swap so there IS a previous set to protect; the second one then dies mid-produce, which
      // is the shape the job takes when its connection error listener fires between two batches.
      await withClient(client => swapNeighborsTable(client, producing(ROWS)))
      rowsBefore = await withClient(
        async client => (await client.query('SELECT count(*)::int AS n FROM marketplace.item_neighbors')).rows[0].n
      )
      try {
        await withClient(client =>
          swapNeighborsTable(client, async insert => {
            await insert([{ itemId: '0xddd-9', source: 'cf', neighborId: '0xeee-8', sim: 0.9, support: 3, rank: 0 }])
            throw new Error('neighbours job connection lost')
          })
        )
      } catch (e) {
        error = e as Error
      }
    })

    it('should surface the producer failure rather than swallow it into a successful-looking run', () => {
      expect(error?.message).toContain('connection lost')
    })

    it('should roll the half-written batch back, leaving the previous neighbours exactly as they were', async () => {
      const rows = await withClient(client => client.query('SELECT count(*)::int AS n FROM marketplace.item_neighbors'))
      expect(rows.rows[0].n).toBe(rowsBefore)
    })

    it("should not leave the aborted run's rows behind", async () => {
      const rows = await withClient(client =>
        client.query("SELECT count(*)::int AS n FROM marketplace.item_neighbors WHERE item_id = '0xddd-9'")
      )
      expect(rows.rows[0].n).toBe(0)
    })
  })
})
