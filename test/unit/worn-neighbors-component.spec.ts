import type { IPgComponent } from '@dcl/pg-component'
import type { NeighborInsertRow } from '../../src/logic/suggestions/neighbors-table'
import { createWornNeighborsComponent, IWornNeighborsComponent, WornNeighborsUnavailableError } from '../../src/ports/worn-neighbors'
import { SELECT_CO_WORN } from '../../src/ports/worn-neighbors/queries'

type FakeCursor = { text: string; values: unknown[]; read: jest.Mock; close: jest.Mock }

const CATALOGUE = { anchorIds: ['0xaaa-0', '0xaaa-1', '0xbbb-0'], candidateIds: ['0xaaa-0', '0xaaa-1'] }

describe('when streaming co-wear neighbours out of the registry', () => {
  let batches: unknown[][][]
  let readError: Error | undefined
  let rollbackError: Error | undefined
  let cursor: FakeCursor | undefined
  let client: { query: jest.Mock; release: jest.Mock }
  let connect: jest.Mock
  let wornNeighbors: IWornNeighborsComponent

  /** Reads every batch, as the build does. */
  async function collect(): Promise<NeighborInsertRow[][]> {
    const collected: NeighborInsertRow[][] = []
    for await (const rows of wornNeighbors.getNeighbors(CATALOGUE)) collected.push(rows)
    return collected
  }

  beforeEach(() => {
    batches = []
    readError = undefined
    rollbackError = undefined
    cursor = undefined
    client = {
      // Synchronous like node-postgres: a submittable comes straight back, a statement as a promise.
      query: jest.fn((statement: unknown) => {
        if (typeof statement !== 'string') {
          // A Cursor: node-postgres hands the submittable back, and it is read from there.
          const { text, values } = statement as { text: string; values: unknown[] }
          cursor = {
            text,
            values,
            read: jest.fn((_count: number, callback: (error: Error | null, rows: unknown[][]) => void) =>
              readError && batches.length === 0 ? callback(readError, []) : callback(null, batches.shift() ?? [])
            ),
            close: jest.fn((callback: () => void) => callback())
          }
          return cursor
        }
        if (statement === 'ROLLBACK' && rollbackError) return Promise.reject(rollbackError)
        return Promise.resolve({ rows: [] })
      }),
      release: jest.fn()
    }
    connect = jest.fn(async () => client)
    wornNeighbors = createWornNeighborsComponent({
      assetBundleRegistryDatabase: { getPool: () => ({ connect }) } as unknown as IPgComponent
    })
  })

  describe('and the registry returns its rows over several reads', () => {
    let yielded: NeighborInsertRow[][]

    beforeEach(async () => {
      batches = [[['0xaaa-0', '0xaaa-1', 0.8, 6, 0]], [['0xaaa-1', '0xaaa-0', 0.8, 6, 0]]]
      yielded = await collect()
    })

    it('should run the co-wear query', () => {
      expect(cursor?.text).toBe(SELECT_CO_WORN)
    })

    it('should bind the anchors and the candidates', () => {
      expect(cursor?.values).toEqual(['{"0xaaa-0","0xaaa-1","0xbbb-0"}', '{"0xaaa-0","0xaaa-1"}'])
    })

    it('should read inside a read-only transaction', () => {
      expect(client.query.mock.calls[0][0]).toBe('BEGIN TRANSACTION READ ONLY')
    })

    it('should yield each read as a batch of worn rows', () => {
      expect(yielded).toEqual([
        [{ itemId: '0xaaa-0', source: 'worn', neighborId: '0xaaa-1', sim: 0.8, support: 6, rank: 0 }],
        [{ itemId: '0xaaa-1', source: 'worn', neighborId: '0xaaa-0', sim: 0.8, support: 6, rank: 0 }]
      ])
    })

    it('should close the cursor', () => {
      expect(cursor?.close).toHaveBeenCalledTimes(1)
    })

    it('should end the read-only transaction', () => {
      expect(client.query).toHaveBeenLastCalledWith('ROLLBACK')
    })

    it('should hand the client back to the pool intact', () => {
      expect(client.release).toHaveBeenCalledWith(false)
    })
  })

  describe('and the pool cannot hand out a connection', () => {
    let error: unknown

    beforeEach(async () => {
      connect.mockRejectedValue(Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }))
      error = await collect().catch((caught: unknown) => caught)
    })

    it('should throw the registry as unavailable', () => {
      expect(error).toBeInstanceOf(WornNeighborsUnavailableError)
    })

    it('should not leak the connection details in the message', () => {
      expect((error as Error).message).toBe(
        'The asset-bundle-registry database could not be read for co-wear neighbours: ECONNREFUSED: connection refused'
      )
    })
  })

  describe('and a read fails midway', () => {
    let error: unknown

    beforeEach(async () => {
      batches = [[['0xaaa-0', '0xaaa-1', 0.8, 6, 0]]]
      readError = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
      error = await collect().catch((caught: unknown) => caught)
    })

    it('should throw the registry as unavailable', () => {
      expect(error).toBeInstanceOf(WornNeighborsUnavailableError)
    })

    it('should still close the cursor', () => {
      expect(cursor?.close).toHaveBeenCalledTimes(1)
    })

    it('should hand the client back intact, since the transaction still rolls back', () => {
      expect(client.release).toHaveBeenCalledWith(false)
    })
  })

  describe('and the caller stops after the first batch', () => {
    beforeEach(async () => {
      batches = [[['0xaaa-0', '0xaaa-1', 0.8, 6, 0]], [['0xaaa-1', '0xaaa-0', 0.8, 6, 0]]]
      for await (const rows of wornNeighbors.getNeighbors(CATALOGUE)) {
        if (rows.length > 0) break
      }
    })

    it('should not read further than it was asked to', () => {
      expect(cursor?.read).toHaveBeenCalledTimes(1)
    })

    it('should still close the cursor', () => {
      expect(cursor?.close).toHaveBeenCalledTimes(1)
    })

    it('should still hand the client back intact', () => {
      expect(client.release).toHaveBeenCalledWith(false)
    })
  })

  describe('and the caller throws while handling a batch', () => {
    let failure: Error
    let error: unknown

    beforeEach(async () => {
      batches = [[['0xaaa-0', '0xaaa-1', 0.8, 6, 0]]]
      failure = new Error('current transaction is aborted')
      error = await (async () => {
        for await (const rows of wornNeighbors.getNeighbors(CATALOGUE)) {
          if (rows.length > 0) throw failure
        }
      })().catch((caught: unknown) => caught)
    })

    it('should leave the caller’s error as it is', () => {
      expect(error).toBe(failure)
    })

    it('should still hand the client back', () => {
      expect(client.release).toHaveBeenCalledWith(false)
    })
  })

  describe('and the transaction cannot be closed', () => {
    beforeEach(async () => {
      rollbackError = new Error('Connection terminated unexpectedly')
      await collect()
    })

    it('should destroy the client rather than lend it out again', () => {
      expect(client.release).toHaveBeenCalledWith(true)
    })
  })
})
