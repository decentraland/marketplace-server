import type Cursor from 'pg-cursor'
import { produceNeighborRows, type BuildTimings, type CursorClient } from '../../src/logic/suggestions/build-neighbors'
import type { NeighborInsertRow, NeighborsMeta } from '../../src/logic/suggestions/neighbors-table'
import { WornNeighborsUnavailableError, type IWornNeighborsComponent } from '../../src/ports/worn-neighbors'

/** The marketplace side of the build: a catalogue of three items and no acquisitions or tags. */
function makeMarketplaceClient(): CursorClient {
  const items = [
    { item_id: '0xaaa-0', is_candidate: true },
    { item_id: '0xaaa-1', is_candidate: true },
    { item_id: '0xbbb-0', is_candidate: false }
  ]
  return {
    query: jest.fn(async (sql: string) => (sql.includes('squid_marketplace.item') ? { rows: items } : { rows: [] })),
    openCursor: () =>
      ({
        read: (_count: number, callback: (error: Error | null, rows: unknown[][]) => void) => callback(null, []),
        close: (callback: () => void) => callback()
      } as unknown as Cursor)
  }
}

const WORN_ROW: NeighborInsertRow = { itemId: '0xbbb-0', source: 'worn', neighborId: '0xaaa-0', sim: 0.5, support: 5, rank: 0 }

describe('when building the neighbour sets with the co-wear source', () => {
  let inserted: NeighborInsertRow[]
  let insert: jest.Mock
  let discard: jest.Mock
  let getNeighbors: jest.Mock
  let wornNeighbors: IWornNeighborsComponent
  let timings: BuildTimings | undefined

  beforeEach(() => {
    inserted = []
    timings = undefined
    insert = jest.fn(async (rows: NeighborInsertRow[]) => {
      inserted.push(...rows)
    })
    discard = jest.fn(async () => undefined)
    getNeighbors = jest.fn(async function* () {
      yield [WORN_ROW]
    })
    wornNeighbors = { getNeighbors }
  })

  describe('and the registry answers', () => {
    let meta: NeighborsMeta

    beforeEach(async () => {
      meta = await produceNeighborRows(makeMarketplaceClient(), insert, { worn: { neighbors: wornNeighbors, discard } }, t => {
        timings = t
      })
    })

    it('should ask for every catalogued item as an anchor and only the candidates as neighbours', () => {
      expect(getNeighbors.mock.calls[0][0]).toEqual({
        anchorIds: ['0xaaa-0', '0xaaa-1', '0xbbb-0'],
        candidateIds: ['0xaaa-0', '0xaaa-1']
      })
    })

    it('should insert the co-wear rows alongside the other sources', () => {
      expect(inserted.filter(row => row.source === 'worn')).toEqual([WORN_ROW])
    })

    it('should count them in the metadata', () => {
      expect(meta.wornRows).toBe(1)
    })

    it('should count the items they cover', () => {
      expect(meta.itemsCovered).toBe(1)
    })

    it('should not discard anything', () => {
      expect(discard).not.toHaveBeenCalled()
    })

    it('should report no co-wear error', () => {
      expect(timings?.wornError).toBeUndefined()
    })
  })

  describe('and the registry becomes unavailable midway', () => {
    let unavailable: WornNeighborsUnavailableError
    let meta: NeighborsMeta

    beforeEach(async () => {
      unavailable = new WornNeighborsUnavailableError(new Error('terminating connection due to administrator command'))
      getNeighbors.mockImplementation(async function* () {
        yield [WORN_ROW]
        throw unavailable
      })
      meta = await produceNeighborRows(makeMarketplaceClient(), insert, { worn: { neighbors: wornNeighbors, discard } }, t => {
        timings = t
      })
    })

    it('should discard the co-wear rows it had already inserted', () => {
      expect(discard).toHaveBeenCalledTimes(1)
    })

    it('should record no co-wear rows', () => {
      expect(meta.wornRows).toBe(0)
    })

    it('should count no covered items from the discarded rows', () => {
      expect(meta.itemsCovered).toBe(0)
    })

    it('should report the registry error rather than throw it', () => {
      expect(timings?.wornError).toBe(unavailable)
    })
  })

  describe('and writing a co-wear row fails', () => {
    let failure: Error
    let error: unknown

    beforeEach(async () => {
      failure = new Error('current transaction is aborted')
      insert.mockImplementation(async (rows: NeighborInsertRow[]) => {
        if (rows.some(row => row.source === 'worn')) throw failure
      })
      error = await produceNeighborRows(makeMarketplaceClient(), insert, { worn: { neighbors: wornNeighbors, discard } }).catch(
        (caught: unknown) => caught
      )
    })

    it('should fail the build, since the swap itself is lost', () => {
      expect(error).toBe(failure)
    })

    it('should not try to discard on a transaction that is gone', () => {
      expect(discard).not.toHaveBeenCalled()
    })
  })

  describe('and no co-wear source is given', () => {
    let meta: NeighborsMeta

    beforeEach(async () => {
      meta = await produceNeighborRows(makeMarketplaceClient(), insert)
    })

    it('should never ask the registry', () => {
      expect(getNeighbors).not.toHaveBeenCalled()
    })

    it('should record no co-wear rows', () => {
      expect(meta.wornRows).toBe(0)
    })
  })
})
