import { IDatabase, ILoggerComponent } from '@well-known-components/interfaces'
import { IPgComponent } from '../../src/ports/db/types'
import { IListsComponents } from '../../src/ports/favorites/lists'
import { ListsNotFoundError } from '../../src/ports/favorites/lists/errors'
import {
  createPicksComponent,
  DBGetFilteredPicksWithCount,
  DBPickStats,
  IPicksComponent,
  PickUnpickInBulkBody
} from '../../src/ports/favorites/picks'
import { ISnapshotComponent } from '../../src/ports/favorites/snapshot'
import { ScoreError } from '../../src/ports/favorites/snapshot/errors'
import { IItemsComponent } from '../../src/ports/items'
import { ItemNotFoundError } from '../../src/ports/items/errors'
import {
  createTestItemsComponent,
  createTestListsComponent,
  createTestLogsComponent,
  createTestPgComponent,
  createTestSnapshotComponent
} from '../components'

let options: {
  userAddress?: string
  power?: number
}
let itemId: string
let userAddress: string
let dbQueryMock: jest.Mock
let dbClientQueryMock: jest.Mock
let dbClientReleaseMock: jest.Mock
let getScoreMock: jest.Mock
let validateItemExistsMock: jest.Mock
let checkNonEditableListsMock: jest.Mock
let pg: IPgComponent & IDatabase
let items: IItemsComponent
let lists: IListsComponents
let snapshot: ISnapshotComponent
let logs: ILoggerComponent
let picksComponent: IPicksComponent

beforeEach(() => {
  dbQueryMock = jest.fn()
  validateItemExistsMock = jest.fn()
  checkNonEditableListsMock = jest.fn()
  getScoreMock = jest.fn()
  dbClientQueryMock = jest.fn()
  dbClientReleaseMock = jest.fn().mockResolvedValue(undefined)

  pg = createTestPgComponent({
    query: dbQueryMock,
    getPool: jest.fn().mockReturnValue({
      connect: () => ({
        query: dbClientQueryMock,
        release: dbClientReleaseMock
      })
    }),
    withTransaction: jest.fn().mockImplementation(async (callback, onError) => {
      try {
        const results = await callback({
          query: dbClientQueryMock,
          release: dbClientReleaseMock
        })
        return results
      } catch (error) {
        if (onError) await onError(error)
        throw error
      }
    })
  })
  userAddress = '0x1dec5f50cb1467f505bb3ddfd408805114406b10'
  itemId = '0x08de0de733cc11081d43569b809c00e6ddf314fb-0'
  options = {
    userAddress,
    power: 2
  }
  logs = createTestLogsComponent({
    getLogger: jest.fn().mockReturnValue({ error: () => undefined, info: () => undefined })
  })
  snapshot = createTestSnapshotComponent({ getScore: getScoreMock })
  items = createTestItemsComponent({
    validateItemExists: validateItemExistsMock
  })
  lists = createTestListsComponent({
    checkNonEditableLists: checkNonEditableListsMock
  })
  picksComponent = createPicksComponent({ favoritesDatabase: pg, items, snapshot, lists, logs })
})

describe('when getting the pick stats of an item', () => {
  let result: DBPickStats[] | undefined
  beforeEach(() => {
    result = undefined
  })

  describe('and the power parameter is set', () => {
    beforeEach(async () => {
      options.power = 20
      dbQueryMock.mockResolvedValueOnce({ rows: [{ item_id: itemId, count: 1000 }] })
      result = await picksComponent.getPicksStats([itemId], options)
    })

    it('should query the favorites that were done by users with power greater and equal than the given power', () => {
      expect(dbQueryMock).toBeCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('voting.power >= '),
          values: expect.arrayContaining([options.power])
        })
      )
    })

    it('should return the amount of favorites', () => {
      expect(result).toEqual([{ item_id: itemId, count: 1000 }])
    })
  })

  describe('and the power parameter is not set', () => {
    beforeEach(async () => {
      options.power = undefined
      dbQueryMock.mockResolvedValueOnce({ rows: [{ item_id: itemId, count: 1000 }] })
      result = await picksComponent.getPicksStats([itemId], options)
    })

    it('should query the favorites that were done by users with power greater and equal than default power', () => {
      expect(dbQueryMock).toBeCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('voting.power >= '),
          values: expect.arrayContaining([1])
        })
      )
    })

    it('should return the amount of favorites', () => {
      expect(result).toEqual([{ item_id: itemId, count: 1000 }])
    })
  })

  describe('and the user address parameter is set', () => {
    beforeEach(async () => {
      options.userAddress = 'aUserAddress'
      dbQueryMock.mockResolvedValueOnce({
        rows: [{ picked_by_user: false, item_id: itemId, count: 1000 }]
      })
      result = await picksComponent.getPicksStats([itemId], options)
    })

    it('should check in the query if the user has picked the item', () => {
      expect(dbQueryMock).toBeCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('MAX(CASE WHEN favorites.picks.user_address = '),
          values: expect.arrayContaining([options.userAddress])
        })
      )
    })

    it('should count the picks even if the voting power is not enough', () => {
      expect(dbQueryMock).toBeCalledWith(
        expect.objectContaining({
          text: expect.stringContaining(' OR favorites.picks.user_address = '),
          values: expect.arrayContaining([options.userAddress])
        })
      )
    })

    it('should return the amount of favorites and the picked by user property', () => {
      expect(result).toEqual([{ picked_by_user: false, item_id: itemId, count: 1000 }])
    })
  })

  describe('and the user address parameter is not set', () => {
    beforeEach(async () => {
      options.userAddress = undefined
      dbQueryMock.mockResolvedValueOnce({ rows: [{ item_id: itemId, count: 1000 }] })
      result = await picksComponent.getPicksStats([itemId], options)
    })

    it('should not check in the query if the user has picked the item', () => {
      expect(dbQueryMock).not.toBeCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('MAX(CASE WHEN favorites.picks.user_address = '),
          values: expect.arrayContaining([options.userAddress])
        })
      )
    })

    it('should not count the picks if the voting power is not enough', () => {
      expect(dbQueryMock).not.toBeCalledWith(
        expect.objectContaining({
          text: expect.stringContaining(' OR favorites.picks.user_address = '),
          values: expect.arrayContaining([options.userAddress])
        })
      )
    })

    it('should return the amount of favorites', () => {
      expect(result).toEqual([{ item_id: itemId, count: 1000 }])
    })
  })
})

describe('when getting picks by item id', () => {
  let dbGetPicksByItemId: DBGetFilteredPicksWithCount[]

  describe('and the query throws an error', () => {
    const errorMessage = 'Something went wrong while querying the database'

    beforeEach(() => {
      dbQueryMock.mockRejectedValueOnce(new Error(errorMessage))
    })

    it('should propagate the error', () => {
      expect(
        picksComponent.getPicksByItemId('item-id', {
          offset: 0,
          limit: 10
        })
      ).rejects.toThrowError(errorMessage)
    })
  })

  describe('and the list id, limit, offset, and power are all set', () => {
    let result: DBGetFilteredPicksWithCount[]

    beforeEach(() => {
      dbGetPicksByItemId = []
      dbQueryMock.mockResolvedValueOnce({ rows: dbGetPicksByItemId })
    })

    describe('and the user address is also set', () => {
      beforeEach(async () => {
        result = await picksComponent.getPicksByItemId('item-id', {
          offset: 0,
          limit: 10,
          power: 5,
          userAddress: 'user-address'
        })
      })

      it('should return the query result', () => {
        expect(result).toEqual(dbGetPicksByItemId)
      })

      it('should have made the query selecting the current user address as the first row', () => {
        expect(dbQueryMock).toBeCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('user_address = '),
            values: expect.arrayContaining(['user-address'])
          })
        )
      })

      it('should count the picks even if the voting power is not enough', () => {
        expect(dbQueryMock).toBeCalledWith(
          expect.objectContaining({
            text: expect.stringContaining(' OR favorites.picks.user_address = '),
            values: expect.arrayContaining(['user-address'])
          })
        )
      })
    })

    describe('and the user address is not set', () => {
      beforeEach(async () => {
        result = await picksComponent.getPicksByItemId('item-id', {
          offset: 0,
          limit: 10,
          power: 5
        })
      })

      it('should return the query result', () => {
        expect(result).toEqual(dbGetPicksByItemId)
      })

      it('should have made the query to get the picks matching those conditions', async () => {
        expect(dbQueryMock).toBeCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('WHERE favorites.picks.item_id ='),
            values: expect.arrayContaining(['item-id'])
          })
        )

        expect(dbQueryMock).toBeCalledWith(
          expect.objectContaining({
            text: expect.stringContaining(
              'AND favorites.voting.user_address = favorites.picks.user_address AND (favorites.voting.power >= '
            ),
            values: expect.arrayContaining([5])
          })
        )

        expect(dbQueryMock).toBeCalledWith(
          expect.objectContaining({ text: expect.stringContaining('ORDER BY picked_by_user DESC, created_at DESC') })
        )

        expect(dbQueryMock).toBeCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('LIMIT $3 OFFSET $4'),
            values: expect.arrayContaining([10, 0])
          })
        )
      })

      it('should not count the picks if the voting power is not enough', () => {
        expect(dbQueryMock).not.toBeCalledWith(
          expect.objectContaining({
            text: expect.stringContaining(' OR favorites.picks.user_address = '),
            values: expect.arrayContaining([options.userAddress])
          })
        )
      })
    })
  })
})

describe('when picking or unpicking an item in bulk', () => {
  let body: PickUnpickInBulkBody

  describe("and the item doesn't exist", () => {
    beforeEach(() => {
      validateItemExistsMock.mockRejectedValueOnce(new ItemNotFoundError(itemId))
    })

    it('should throw an item not found error', () => {
      return expect(picksComponent.pickAndUnpickInBulk(itemId, {}, userAddress)).rejects.toEqual(new ItemNotFoundError(itemId))
    })
  })

  describe('and there are non-editable lists', () => {
    beforeEach(() => {
      validateItemExistsMock.mockResolvedValueOnce(undefined)
      checkNonEditableListsMock.mockRejectedValueOnce(new ListsNotFoundError(['list-id-1', 'list-id-2']))
    })

    it('should throw a lists not found error', () => {
      return expect(picksComponent.pickAndUnpickInBulk(itemId, {}, userAddress)).rejects.toEqual(
        new ListsNotFoundError(['list-id-1', 'list-id-2'])
      )
    })
  })

  describe('when the pick for lists query fails', () => {
    const error = new Error('Something went wrong while inserting the new picks in the database')
    beforeEach(() => {
      body = {
        pickedFor: ['list-id-1', 'list-id-2']
      }

      validateItemExistsMock.mockResolvedValueOnce(undefined)
      checkNonEditableListsMock.mockResolvedValueOnce(undefined)
      dbClientQueryMock.mockRejectedValueOnce(error)
    })

    it('should throw the error', () => {
      return expect(picksComponent.pickAndUnpickInBulk(itemId, body, userAddress)).rejects.toEqual(error)
    })
  })

  describe('when the unpick from lists query fails', () => {
    const error = new Error('Something went wrong while deleting picks in the database')
    beforeEach(() => {
      body = {
        unpickedFrom: ['list-id-1', 'list-id-2']
      }

      validateItemExistsMock.mockResolvedValueOnce(undefined)
      checkNonEditableListsMock.mockResolvedValueOnce(undefined)
      dbClientQueryMock.mockRejectedValueOnce(error)
    })

    it('should throw the error', () => {
      return expect(picksComponent.pickAndUnpickInBulk(itemId, body, userAddress)).rejects.toEqual(error)
    })
  })

  describe('when the insert VP query fails', () => {
    const error = new Error('Something went wrong while inserting the VP in the database')
    beforeEach(() => {
      body = {
        pickedFor: ['list-id-1', 'list-id-2']
      }

      validateItemExistsMock.mockResolvedValueOnce(undefined)
      checkNonEditableListsMock.mockResolvedValueOnce(undefined)
      // Insert new picks
      dbClientQueryMock.mockResolvedValueOnce(undefined)
      // Insert VP
      dbClientQueryMock.mockRejectedValueOnce(error)
    })

    it('should throw the error', () => {
      return expect(picksComponent.pickAndUnpickInBulk(itemId, body, userAddress)).rejects.toEqual(error)
    })
  })

  describe('when there are some lists that have been picked', () => {
    beforeEach(() => {
      body = {
        pickedFor: ['list-id-1', 'list-id-2']
      }

      validateItemExistsMock.mockResolvedValueOnce(undefined)
      checkNonEditableListsMock.mockResolvedValueOnce(undefined)
    })

    describe('and the query to get the VP fails', () => {
      beforeEach(async () => {
        getScoreMock.mockRejectedValueOnce(new ScoreError('Something went wrong while getting the VP', userAddress))
        // Insert new picks
        dbClientQueryMock.mockResolvedValueOnce(undefined)
        // Insert 0 as the VP
        dbClientQueryMock.mockResolvedValueOnce(undefined)

        await picksComponent.pickAndUnpickInBulk(itemId, body, userAddress)
      })

      it('should insert the new picks in the selected lists', () => {
        expect(dbClientQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining(
              'INSERT INTO favorites.picks (item_id, user_address, list_id) SELECT $1, $2, id AS list_id FROM favorites.lists WHERE id = ANY($3)'
            ),
            values: expect.arrayContaining([itemId, userAddress, body.pickedFor])
          })
        )
      })

      it('should insert 0 as the new VP', () => {
        expect(dbClientQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('VALUES ($1, $2) ON CONFLICT (user_address) DO NOTHING'),
            values: expect.arrayContaining([userAddress, 0])
          })
        )
      })
    })

    describe('and the query to get the VP succeeds', () => {
      let power: number
      beforeEach(async () => {
        power = 10
        getScoreMock.mockResolvedValueOnce(power)
        // Insert new picks
        dbClientQueryMock.mockResolvedValueOnce(undefined)
        // Insert 0 as the VP
        dbClientQueryMock.mockResolvedValueOnce(undefined)

        await picksComponent.pickAndUnpickInBulk(itemId, body, userAddress)
      })

      it('should insert the new picks in the selected lists', () => {
        expect(dbClientQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining(
              'INSERT INTO favorites.picks (item_id, user_address, list_id) SELECT $1, $2, id AS list_id FROM favorites.lists WHERE id = ANY($3)'
            ),
            values: expect.arrayContaining([itemId, userAddress, body.pickedFor])
          })
        )
      })

      it('should insert the new VP got from snapshot', () => {
        expect(dbClientQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('VALUES ($1, $2) ON CONFLICT (user_address) DO UPDATE SET power = $3'),
            values: expect.arrayContaining([userAddress, power, power])
          })
        )
      })
    })
  })

  describe('when there are some lists that have been unpicked', () => {
    beforeEach(async () => {
      body = {
        unpickedFrom: ['list-id-1', 'list-id-2']
      }

      validateItemExistsMock.mockResolvedValueOnce(undefined)
      checkNonEditableListsMock.mockResolvedValueOnce(undefined)

      // Delete picks
      dbClientQueryMock.mockResolvedValueOnce(undefined)

      await picksComponent.pickAndUnpickInBulk(itemId, body, userAddress)
    })

    it('should delete new picks from the selected lists', () => {
      expect(dbClientQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('DELETE FROM favorites.picks WHERE item_id = $1 AND user_address = $2 AND list_id = ANY($3)'),
          values: expect.arrayContaining([itemId, userAddress, body.unpickedFrom])
        })
      )
    })
  })
})
