import type { SQLStatement } from 'sql-template-strings'
import type { IPgComponent } from '@dcl/pg-component'
import {
  createWornNeighborsComponent,
  IWornNeighborsComponent,
  WornNeighbor,
  WornNeighborsUnavailableError
} from '../../src/ports/worn-neighbors'

type CoWornRow = { item_id: string; neighbor_id: string; sim: number; support: string; rank: string }

const CATALOGUE = { anchorIds: ['0xaaa-0', '0xaaa-1', '0xbbb-0'], candidateIds: ['0xaaa-0', '0xaaa-1'] }

function row(index: number): CoWornRow {
  return { item_id: `0xaaa-${index}`, neighbor_id: '0xbbb-0', sim: 0.8, support: '6', rank: '0' }
}

describe('when reading co-wear neighbours out of the registry', () => {
  let rows: CoWornRow[]
  let failAfter: number | undefined
  let rowsRead: number
  let streamClosed: boolean
  let streamQuery: jest.Mock
  let wornNeighbors: IWornNeighborsComponent

  /** Reads every batch, as the build does. */
  async function collect(): Promise<WornNeighbor[][]> {
    const collected: WornNeighbor[][] = []
    for await (const batch of wornNeighbors.getNeighbors(CATALOGUE)) collected.push(batch)
    return collected
  }

  beforeEach(() => {
    rows = []
    failAfter = undefined
    rowsRead = 0
    streamClosed = false
    streamQuery = jest.fn(async function* () {
      try {
        for (const next of rows) {
          if (failAfter !== undefined && rowsRead === failAfter) {
            throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
          }
          rowsRead += 1
          yield next
        }
      } finally {
        streamClosed = true
      }
    })
    wornNeighbors = createWornNeighborsComponent({ assetBundleRegistryDatabase: { streamQuery } as unknown as IPgComponent })
  })

  describe('and the registry returns fewer rows than a batch', () => {
    let batches: WornNeighbor[][]

    beforeEach(async () => {
      rows = [row(0), row(1)]
      batches = await collect()
    })

    it('should stream the co-wear query with the anchors and the candidates bound', () => {
      expect((streamQuery.mock.calls[0][0] as SQLStatement).values).toEqual([CATALOGUE.anchorIds, CATALOGUE.candidateIds])
    })

    it('should fetch the rows in batches of twenty thousand', () => {
      expect(streamQuery.mock.calls[0][1]).toEqual({ batchSize: 20_000 })
    })

    it('should yield them as one batch of neighbours', () => {
      expect(batches).toEqual([
        [
          { itemId: '0xaaa-0', neighborId: '0xbbb-0', sim: 0.8, support: 6, rank: 0 },
          { itemId: '0xaaa-1', neighborId: '0xbbb-0', sim: 0.8, support: 6, rank: 0 }
        ]
      ])
    })
  })

  describe('and the registry returns more rows than a batch', () => {
    let batches: WornNeighbor[][]

    beforeEach(async () => {
      rows = Array.from({ length: 20_001 }, (_, index) => row(index))
      batches = await collect()
    })

    it('should yield a full batch, then the remainder', () => {
      expect(batches.map(batch => batch.length)).toEqual([20_000, 1])
    })
  })

  describe('and the stream cannot be opened', () => {
    let error: unknown

    beforeEach(async () => {
      streamQuery.mockImplementation(async function* () {
        yield* []
        throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })
      })
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

  describe('and the stream fails midway', () => {
    let error: unknown

    beforeEach(async () => {
      rows = [row(0), row(1)]
      failAfter = 1
      error = await collect().catch((caught: unknown) => caught)
    })

    it('should throw the registry as unavailable', () => {
      expect(error).toBeInstanceOf(WornNeighborsUnavailableError)
    })
  })

  describe('and the caller stops after the first batch', () => {
    beforeEach(async () => {
      rows = Array.from({ length: 40_001 }, (_, index) => row(index))
      for await (const batch of wornNeighbors.getNeighbors(CATALOGUE)) {
        if (batch.length > 0) break
      }
    })

    it('should not read further than the batch it handed out', () => {
      expect(rowsRead).toBe(20_000)
    })

    it('should close the stream, which releases its connection', () => {
      expect(streamClosed).toBe(true)
    })
  })

  describe('and the caller throws while handling a batch', () => {
    let failure: Error
    let error: unknown

    beforeEach(async () => {
      rows = [row(0)]
      failure = new Error('current transaction is aborted')
      error = await (async () => {
        for await (const batch of wornNeighbors.getNeighbors(CATALOGUE)) {
          if (batch.length > 0) throw failure
        }
      })().catch((caught: unknown) => caught)
    })

    it('should leave the caller’s error as it is', () => {
      expect(error).toBe(failure)
    })

    it('should still close the stream', () => {
      expect(streamClosed).toBe(true)
    })
  })
})
