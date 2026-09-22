import type Cursor from 'pg-cursor'
import {
  produceNeighborRows,
  type BuildTimings,
  type CursorClient,
  type LoadedCatalogue
} from '../../src/logic/suggestions/build-neighbors'
import type { NeighborInsertRow, NeighborsMeta } from '../../src/logic/suggestions/neighbors-table'
import { SELECT_CO_WORN, produceWornRows } from '../../src/logic/suggestions/worn'

type OpenedCursor = { text: string; values: unknown[] }

/** A client whose cursors hand out `batches` in order, or fail on the read given by `failOnRead`. */
function makeCursorClient(options: {
  batches?: unknown[][][]
  failOnRead?: number
  itemRows?: Record<string, unknown>[]
}): CursorClient & { opened: OpenedCursor[]; closed: number } {
  const opened: OpenedCursor[] = []
  const client = {
    opened,
    closed: 0,
    query: jest.fn(async (sql: string) => (sql.includes('squid_marketplace.item') ? { rows: options.itemRows ?? [] } : { rows: [] })),
    openCursor: (cursor: Cursor) => {
      const { text, values } = cursor as unknown as OpenedCursor
      opened.push({ text, values })
      const batches = text === SELECT_CO_WORN ? [...(options.batches ?? [])] : []
      let reads = 0
      return {
        read: (_count: number, callback: (error: Error | null, rows: unknown[][]) => void) => {
          reads += 1
          if (text === SELECT_CO_WORN && options.failOnRead === reads) {
            callback(new Error('terminating connection due to administrator command'), [])
            return
          }
          callback(null, batches.shift() ?? [])
        },
        close: (callback: () => void) => {
          client.closed += 1
          callback()
        }
      } as unknown as Cursor
    }
  }
  return client
}

const CATALOGUE: LoadedCatalogue = {
  items: [
    { index: 0, id: '0xaaa-0', creator: '', collection: '', subCategory: '', rarityTier: -1, price: 0, isCandidate: true },
    { index: 1, id: '0xaaa-1', creator: '', collection: '', subCategory: '', rarityTier: -1, price: 0, isCandidate: true },
    { index: 2, id: '0xbbb-0', creator: '', collection: '', subCategory: '', rarityTier: -1, price: 0, isCandidate: false }
  ],
  indexById: new Map([
    ['0xaaa-0', 0],
    ['0xaaa-1', 1],
    ['0xbbb-0', 2]
  ])
}

const ITEM_ROWS = CATALOGUE.items.map(item => ({ item_id: item.id, is_candidate: item.isCandidate }))

describe('when streaming the co-wear neighbours out of the registry', () => {
  let client: ReturnType<typeof makeCursorClient>
  let inserted: NeighborInsertRow[][]
  let insert: jest.Mock

  beforeEach(() => {
    inserted = []
    insert = jest.fn(async (rows: NeighborInsertRow[]) => {
      inserted.push(rows)
    })
  })

  describe('and the registry returns its rows over several reads', () => {
    let written: number

    beforeEach(async () => {
      client = makeCursorClient({
        batches: [[['0xaaa-0', '0xaaa-1', 0.8, 6, 0]], [['0xaaa-1', '0xaaa-0', 0.8, 6, 0]]]
      })
      written = await produceWornRows(client, CATALOGUE, insert)
    })

    it('should send every catalogued item as an anchor and only the candidates as neighbours', () => {
      expect(client.opened[0].values).toEqual(['{"0xaaa-0","0xaaa-1","0xbbb-0"}', '{"0xaaa-0","0xaaa-1"}'])
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

    it('should close the cursor', () => {
      expect(client.closed).toBe(1)
    })
  })

  describe('and a read fails', () => {
    let error: unknown

    beforeEach(async () => {
      client = makeCursorClient({ batches: [[['0xaaa-0', '0xaaa-1', 0.8, 6, 0]]], failOnRead: 2 })
      error = await produceWornRows(client, CATALOGUE, insert).catch(caught => caught)
    })

    it('should reject with the read error', () => {
      expect(error).toEqual(new Error('terminating connection due to administrator command'))
    })

    it('should still close the cursor', () => {
      expect(client.closed).toBe(1)
    })
  })
})

describe('when building the neighbour sets with the co-wear source', () => {
  let marketplace: ReturnType<typeof makeCursorClient>
  let registry: ReturnType<typeof makeCursorClient>
  let inserted: NeighborInsertRow[]
  let insert: jest.Mock
  let discard: jest.Mock
  let timings: BuildTimings | undefined

  beforeEach(() => {
    inserted = []
    timings = undefined
    marketplace = makeCursorClient({ itemRows: ITEM_ROWS })
    insert = jest.fn(async (rows: NeighborInsertRow[]) => {
      inserted.push(...rows)
    })
    discard = jest.fn(async () => undefined)
  })

  describe('and the registry answers', () => {
    let meta: NeighborsMeta

    beforeEach(async () => {
      registry = makeCursorClient({ batches: [[['0xbbb-0', '0xaaa-0', 0.5, 5, 0]]] })
      meta = await produceNeighborRows(marketplace, insert, { worn: { client: registry, discard } }, t => {
        timings = t
      })
    })

    it('should insert the co-wear rows alongside the other sources', () => {
      expect(inserted.filter(row => row.source === 'worn')).toEqual([
        { itemId: '0xbbb-0', source: 'worn', neighborId: '0xaaa-0', sim: 0.5, support: 5, rank: 0 }
      ])
    })

    it('should record them in the metadata', () => {
      expect([meta.wornRows, meta.itemsCovered]).toEqual([1, 1])
    })

    it('should not discard anything', () => {
      expect(discard).not.toHaveBeenCalled()
    })

    it('should report no co-wear error', () => {
      expect(timings?.wornError).toBeUndefined()
    })
  })

  describe('and the registry fails midway', () => {
    let meta: NeighborsMeta

    beforeEach(async () => {
      registry = makeCursorClient({ batches: [[['0xbbb-0', '0xaaa-0', 0.5, 5, 0]]], failOnRead: 2 })
      meta = await produceNeighborRows(marketplace, insert, { worn: { client: registry, discard } }, t => {
        timings = t
      })
    })

    it('should discard the co-wear rows it had already inserted', () => {
      expect(discard).toHaveBeenCalledTimes(1)
    })

    it('should record no co-wear rows and no covered items from them', () => {
      expect([meta.wornRows, meta.itemsCovered]).toEqual([0, 0])
    })

    it('should report the registry error rather than throw it', () => {
      expect(timings?.wornError).toEqual(new Error('terminating connection due to administrator command'))
    })
  })

  describe('and writing a co-wear row fails', () => {
    let error: unknown

    beforeEach(async () => {
      registry = makeCursorClient({ batches: [[['0xbbb-0', '0xaaa-0', 0.5, 5, 0]]] })
      insert.mockImplementation(async (rows: NeighborInsertRow[]) => {
        if (rows.some(row => row.source === 'worn')) throw new Error('current transaction is aborted')
      })
      error = await produceNeighborRows(marketplace, insert, { worn: { client: registry, discard } }).catch(caught => caught)
    })

    it('should fail the build, since the swap itself is lost', () => {
      expect(error).toEqual(new Error('current transaction is aborted'))
    })

    it('should not try to discard on a transaction that is gone', () => {
      expect(discard).not.toHaveBeenCalled()
    })
  })

  describe('and no registry is configured', () => {
    let meta: NeighborsMeta

    beforeEach(async () => {
      meta = await produceNeighborRows(marketplace, insert)
    })

    it('should never run the co-wear query', () => {
      expect(marketplace.opened.map(cursor => cursor.text)).not.toContain(SELECT_CO_WORN)
    })

    it('should record no co-wear rows', () => {
      expect(meta.wornRows).toBe(0)
    })
  })
})
