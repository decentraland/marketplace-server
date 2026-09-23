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
  let inserted: NeighborInsertRow[][]
  let insert: jest.Mock
  let wornNeighbors: IWornNeighborsComponent

  beforeEach(() => {
    batches = []
    readError = undefined
    rollbackError = undefined
    cursor = undefined
    inserted = []
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
    insert = jest.fn(async (rows: NeighborInsertRow[]) => {
      inserted.push(rows)
    })
    wornNeighbors = createWornNeighborsComponent({
      assetBundleRegistryDatabase: { getPool: () => ({ connect }) } as unknown as IPgComponent
    })
  })

  describe('and the registry returns its rows over several reads', () => {
    let written: number

    beforeEach(async () => {
      batches = [[['0xaaa-0', '0xaaa-1', 0.8, 6, 0]], [['0xaaa-1', '0xaaa-0', 0.8, 6, 0]]]
      written = await wornNeighbors.streamNeighbors(CATALOGUE, insert)
    })

    it('should run the co-wear query with the anchors and the candidates', () => {
      expect([cursor?.text, cursor?.values]).toEqual([SELECT_CO_WORN, ['{"0xaaa-0","0xaaa-1","0xbbb-0"}', '{"0xaaa-0","0xaaa-1"}']])
    })

    it('should read inside a read-only transaction', () => {
      expect(client.query.mock.calls[0][0]).toBe('BEGIN TRANSACTION READ ONLY')
    })

    it('should insert each read as it arrives, as worn rows', () => {
      expect(inserted).toEqual([
        [{ itemId: '0xaaa-0', source: 'worn', neighborId: '0xaaa-1', sim: 0.8, support: 6, rank: 0 }],
        [{ itemId: '0xaaa-1', source: 'worn', neighborId: '0xaaa-0', sim: 0.8, support: 6, rank: 0 }]
      ])
    })

    it('should report how many rows it wrote', () => {
      expect(written).toBe(2)
    })

    it('should close the cursor and the transaction, and hand the client back intact', () => {
      expect([cursor?.close.mock.calls.length, client.query.mock.calls.at(-1)?.[0], client.release.mock.calls]).toEqual([
        1,
        'ROLLBACK',
        [[false]]
      ])
    })
  })

  describe('and the pool cannot hand out a connection', () => {
    let error: unknown

    beforeEach(async () => {
      connect.mockRejectedValue(Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }))
      error = await wornNeighbors.streamNeighbors(CATALOGUE, insert).catch((caught: unknown) => caught)
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
      error = await wornNeighbors.streamNeighbors(CATALOGUE, insert).catch((caught: unknown) => caught)
    })

    it('should throw the registry as unavailable', () => {
      expect(error).toBeInstanceOf(WornNeighborsUnavailableError)
    })

    it('should still close the cursor and hand the client back, since the transaction still rolls back', () => {
      expect([cursor?.close.mock.calls.length, client.release.mock.calls]).toEqual([1, [[false]]])
    })
  })

  describe('and inserting a batch fails', () => {
    let failure: Error
    let error: unknown

    beforeEach(async () => {
      batches = [[['0xaaa-0', '0xaaa-1', 0.8, 6, 0]]]
      failure = new Error('current transaction is aborted')
      insert.mockRejectedValue(failure)
      error = await wornNeighbors.streamNeighbors(CATALOGUE, insert).catch((caught: unknown) => caught)
    })

    it('should rethrow the caller’s own error as is, so it is not mistaken for the registry’s', () => {
      expect(error).toBe(failure)
    })
  })

  describe('and the transaction cannot be closed', () => {
    beforeEach(async () => {
      rollbackError = new Error('Connection terminated unexpectedly')
      await wornNeighbors.streamNeighbors(CATALOGUE, insert)
    })

    it('should destroy the client rather than lend it out again', () => {
      expect(client.release).toHaveBeenCalledWith(true)
    })
  })
})
