import { ILoggerComponent } from '@well-known-components/interfaces'
import { IPgComponent } from '../../src/ports/db/types'
import { IItemsComponent, createItemsComponent } from '../../src/ports/favorites/items'
import { ItemNotFoundError } from '../../src/ports/favorites/items/errors'
import { QueryFailure } from '../../src/ports/favorites/lists/errors'
import { createTestLogsComponent, createTestPgComponent } from '../components'

let itemId: string
let items: IItemsComponent
let logs: ILoggerComponent
let dappsDatabase: IPgComponent
let dbClientQueryMock: jest.Mock
let dbClientReleaseMock: jest.Mock

beforeEach(() => {
  logs = createTestLogsComponent({
    getLogger: jest.fn().mockReturnValue({ error: () => undefined, info: () => undefined })
  })
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
  items = createItemsComponent({
    dappsDatabase,
    logs
  })
  itemId = '0x08de0de733cc11081d43569b809c00e6ddf314fb-0'
})

describe('when validating if an item exists', () => {
  describe('and the collections subgraph query fails without a message', () => {
    beforeEach(() => {
      dbClientQueryMock.mockRejectedValue('Unknown')
    })

    it('should throw an error saying that the request failed with its message', () => {
      return expect(items.validateItemExists(itemId)).rejects.toEqual(new QueryFailure('Unknown'))
    })
  })

  describe('and the collections subgraph query fails with a message', () => {
    beforeEach(() => {
      dbClientQueryMock.mockRejectedValueOnce(new Error('anError'))
    })

    it('should throw an error saying that the request failed with its message', () => {
      return expect(items.validateItemExists(itemId)).rejects.toEqual(new QueryFailure('anError'))
    })
  })

  describe("and the item doesn't exist", () => {
    beforeEach(() => {
      dbClientQueryMock.mockResolvedValue({ rows: [] })
    })

    it('should throw an item not found error', () => {
      return expect(items.validateItemExists(itemId)).rejects.toEqual(new ItemNotFoundError(itemId))
    })
  })

  describe('and the item exists', () => {
    beforeEach(() => {
      dbClientQueryMock.mockResolvedValue({
        rows: [{ id: itemId }]
      })
    })

    it('should resolve without any specific result', async () => {
      await expect(items.validateItemExists(itemId)).resolves.toEqual(undefined)
    })
  })
})
