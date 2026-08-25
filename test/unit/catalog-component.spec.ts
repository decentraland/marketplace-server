import { Analytics } from '@segment/analytics-node'
import { Network } from '@dcl/schemas'
import { HttpError } from '../../src/logic/http/response'
import { createCatalogComponent } from '../../src/ports/catalog/component'
import { CollectionsItemDBResult, ICatalogComponent } from '../../src/ports/catalog/types'
import { FragmentItemType } from '../../src/ports/catalog/utils'
import { IPicksComponent } from '../../src/ports/favorites/picks'
import { AppComponents } from '../../src/types'
import { createTestPgComponent } from '../components'

jest.mock('@segment/analytics-node')

let catalogComponent: ICatalogComponent
let dappsDatabase: AppComponents['dappsDatabase']
let dappsWriteDatabase: AppComponents['dappsDatabase']
let picks: IPicksComponent
let dbClientQueryMock: jest.Mock
let dbClientReleaseMock: jest.Mock
let segmentWriteKey: string
let analyticsTrackMock: jest.Mock

beforeEach(async () => {
  analyticsTrackMock = jest.fn()
  // The component builds its Analytics client once, on creation, so the mock has to be in place before
  // createCatalogComponent runs rather than inside the individual test setups.
  ;(Analytics as jest.Mock).mockImplementation(() => ({ track: analyticsTrackMock }))
  dbClientQueryMock = jest.fn()
  dbClientReleaseMock = jest.fn().mockResolvedValue(undefined)
  dappsDatabase = createTestPgComponent({
    getPool: jest.fn().mockReturnValue({
      connect: () => ({
        query: dbClientQueryMock,
        release: dbClientReleaseMock
      })
    })
  })
  dappsWriteDatabase = createTestPgComponent({
    getPool: jest.fn().mockReturnValue({
      connect: () => ({
        query: dbClientQueryMock,
        release: dbClientReleaseMock
      })
    })
  })

  picks = {
    getPicksStats: jest.fn(),
    getPicksByItemId: jest.fn(),
    pickAndUnpickInBulk: jest.fn()
  }

  segmentWriteKey = 'testSegmentWriteKey'
  catalogComponent = await createCatalogComponent({ dappsDatabase, dappsWriteDatabase, picks }, segmentWriteKey)
})

describe('Catalog Component', () => {
  describe('when fetching catalog items', () => {
    describe('and there are no results from the search text query', () => {
      beforeEach(() => {
        dbClientQueryMock.mockResolvedValueOnce({ rows: [] })
      })

      it('should return empty data if no items match the search text', async () => {
        const filters = { search: 'nonexistent item' }
        const result = await catalogComponent.fetch(filters, { searchId: 'testSearchId', anonId: 'anon123' })

        expect(result).toEqual({ data: [], total: 0 })
        expect(dbClientQueryMock).toHaveBeenCalledTimes(1)
      })
    })

    describe('and there are results from the search text query', () => {
      let items: Partial<CollectionsItemDBResult>[]
      beforeEach(() => {
        items = [
          {
            id: 'item1',
            item_type: FragmentItemType.WEARABLE_V1,
            image:
              'https://peer.decentraland.zone/lambdas/collections/contents/urn:decentraland:amoy:collections-v2:0x60aba8c01848c7ef7c1a5451ff11ca05b2b4893e:0/thumbnail'
          },
          {
            id: 'item2',
            item_type: FragmentItemType.WEARABLE_V1,
            image:
              'https://peer.decentraland.zone/lambdas/collections/contents/urn:decentraland:amoy:collections-v2:0x60aba8c01848c7ef7c1a5451ff11ca05b2b4893e:0/thumbnail'
          }
        ]
        dbClientQueryMock.mockResolvedValueOnce({
          rows: [
            { id: 'item1', word: 'Item 1', word_similarity: 0.9, match_type: 'exact' },
            { id: 'item2', word: 'Item 2', word_similarity: 0.8, match_type: 'partial' }
          ]
        })
        dbClientQueryMock.mockResolvedValueOnce({
          rows: items.map(item => ({ ...item }))
        })
        dbClientQueryMock.mockResolvedValueOnce({
          rows: [{ total: items.length }]
        })
        ;(picks.getPicksStats as jest.Mock).mockResolvedValue([])
      })

      it('should return catalog items based on the provided filters', async () => {
        const filters = { search: 'item', network: Network.ETHEREUM }
        const result = await catalogComponent.fetch(filters, { searchId: 'testSearchId', anonId: 'anon123' })

        expect(result.data).toEqual(expect.arrayContaining(items.map(item => expect.objectContaining({ id: item.id }))))
        expect(result.total).toBe(items.length)
        expect(analyticsTrackMock).toHaveBeenCalled()
      })

      it('should track the search event with Segment Analytics', async () => {
        dbClientQueryMock.mockResolvedValueOnce({ rows: items })

        const filters = { search: 'item' }
        await catalogComponent.fetch(filters, { searchId: 'testSearchId', anonId: 'anon123' })

        expect(analyticsTrackMock).toHaveBeenCalledWith(
          expect.objectContaining({
            event: 'Catalog Search',
            anonymousId: 'anon123',
            properties: {
              search: 'item',
              searchId: 'testSearchId',
              results: expect.arrayContaining(items.map(item => expect.objectContaining({ item_id: item.id })))
            }
          })
        )
      })
    })

    describe('and the database query fails', () => {
      beforeEach(() => {
        dbClientQueryMock.mockRejectedValue(new Error('Database error'))
      })
      it('should throw an HttpError if the database query fails', async () => {
        const filters = { search: 'item' }
        await expect(catalogComponent.fetch(filters, { searchId: 'testSearchId', anonId: 'anon123' })).rejects.toThrow(HttpError)

        expect(dbClientReleaseMock).toHaveBeenCalled()
      })
    })
  })

  describe('updateBuilderServerItemsView', () => {
    describe('and the query is successful', () => {
      beforeEach(() => {
        dbClientQueryMock.mockResolvedValue(undefined)
      })
      it('should refresh materialized views', async () => {
        await catalogComponent.updateBuilderServerItemsView()

        expect(dbClientQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            strings: expect.arrayContaining([expect.stringContaining('REFRESH MATERIALIZED VIEW')])
          })
        )
      })

      it('should rebuild the search words table on its own connection, so a timed out statement cannot leak into the refresh', async () => {
        dbClientQueryMock.mockImplementation((sql: unknown) =>
          typeof sql === 'string' && sql.includes('pg_try_advisory_xact_lock')
            ? Promise.resolve({ rows: [{ acquired: true }] })
            : Promise.resolve({ rows: [] })
        )

        await catalogComponent.updateBuilderServerItemsView()
        const statements = dbClientQueryMock.mock.calls.map(([sql]) => sql).filter((sql): sql is string => typeof sql === 'string')

        expect(statements).toContain('COMMIT')
        expect(statements.some(sql => sql.includes('item_search_words_staging'))).toBe(true)
        // one connection for the refresh, a separate one for the rebuild
        expect(dbClientReleaseMock).toHaveBeenCalledTimes(2)
      })
    })

    describe('and the query fails', () => {
      let consoleErrorMock: jest.SpyInstance

      beforeEach(() => {
        // Mock console.error
        consoleErrorMock = jest.spyOn(console, 'error').mockImplementation(() => undefined)
        dbClientQueryMock.mockRejectedValue(new Error('Failed to refresh views'))
      })

      afterEach(() => {
        // Restore console.error after the test
        consoleErrorMock.mockRestore()
      })

      it('should handle errors and release the client', async () => {
        await catalogComponent.updateBuilderServerItemsView()

        expect(consoleErrorMock).toHaveBeenCalled()
        expect(dbClientReleaseMock).toHaveBeenCalled()
      })
    })
  })
})
