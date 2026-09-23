import type { PoolClient } from 'pg'
import Cursor from 'pg-cursor'
import type { NeighborInsertRow } from '../../logic/suggestions/neighbors-table'
import { AppComponents } from '../../types'
import { WornNeighborsUnavailableError } from './errors'
import { SELECT_CO_WORN } from './queries'
import { IWornNeighborsComponent, WornNeighborsCatalogue } from './types'

/** Rows read per cursor fetch, and so per insert. */
const BATCH_SIZE = 20_000

export function createWornNeighborsComponent(components: Pick<AppComponents, 'assetBundleRegistryDatabase'>): IWornNeighborsComponent {
  const { assetBundleRegistryDatabase } = components

  /**
   * One client is borrowed for the whole iteration, inside a read-only transaction so nothing on it can
   * write. The pool keeps its own error listener on every client, so a dropped connection surfaces as a
   * failed read rather than an unhandled event. A caller that stops early, by breaking or throwing,
   * runs the `finally` blocks below all the same.
   */
  async function* getNeighbors(catalogue: WornNeighborsCatalogue): AsyncGenerator<NeighborInsertRow[], void, undefined> {
    let client: PoolClient
    try {
      client = await assetBundleRegistryDatabase.getPool().connect()
    } catch (error) {
      throw new WornNeighborsUnavailableError(error)
    }

    try {
      await registryRead(() => client.query('BEGIN TRANSACTION READ ONLY'))
      // node-postgres overloads `query` as the cursor entry point, which its typings do not know Cursor for
      const cursor = (client as unknown as { query: (c: Cursor) => Cursor }).query(
        new Cursor(SELECT_CO_WORN, [catalogue.anchorIds, catalogue.candidateIds], { rowMode: 'array' })
      )
      try {
        for (;;) {
          const rows = await registryRead(
            () =>
              new Promise<unknown[][]>((resolve, reject) => {
                cursor.read(BATCH_SIZE, (error, batch) => (error ? reject(error) : resolve(batch)))
              })
          )
          if (rows.length === 0) return
          yield rows.map(toInsertRow)
        }
      } finally {
        await new Promise<void>(resolve => cursor.close(() => resolve()))
      }
    } finally {
      await release(client)
    }
  }

  return { getNeighbors }
}

/** Marks a failure as the registry's, so the caller can tell it from its own. */
async function registryRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    throw new WornNeighborsUnavailableError(error)
  }
}

/**
 * Ends the read-only transaction and hands the client back. A failed read leaves a transaction that
 * ROLLBACK still closes; a client on which even that fails is destroyed rather than lent out again.
 */
async function release(client: PoolClient): Promise<void> {
  let destroy = false
  try {
    await client.query('ROLLBACK')
  } catch {
    destroy = true
  }
  client.release(destroy)
}

function toInsertRow(row: unknown[]): NeighborInsertRow {
  return {
    itemId: String(row[0]),
    source: 'worn',
    neighborId: String(row[1]),
    sim: Number(row[2]),
    support: Number(row[3]),
    rank: Number(row[4])
  }
}
