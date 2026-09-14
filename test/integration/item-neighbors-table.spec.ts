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
  const META = { cfRows: 1, contentRows: 1, itemsCovered: 1, durationMs: 42 }

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
      outcome = await withClient(client => swapNeighborsTable(client, ROWS, META))
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
        await withClient(client => swapNeighborsTable(client, ROWS, { ...META, durationMs: 43 }))
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
        await withClient(client => swapNeighborsTable(client, [...ROWS, ROWS[0]], META))
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
})
