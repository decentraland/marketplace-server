import { IDatabase, ILoggerComponent } from '@well-known-components/interfaces'
import { DEFAULT_LIST_ID, DEFAULT_LIST_USER_ADDRESS } from '../../src/migrations/favorites/1678303321034_default-list'
import { IPgComponent } from '../../src/ports/db/types'
import { Permission } from '../../src/ports/favorites/access'
import { AccessNotFoundError } from '../../src/ports/favorites/access/errors'
import { IItemsComponent } from '../../src/ports/favorites/items'
import { ItemNotFoundError } from '../../src/ports/favorites/items/errors'
import {
  createListsComponent,
  DBGetListsWithCount,
  DBList,
  IListsComponents,
  ListSortBy,
  ListSortDirection,
  UpdateListRequestBody
} from '../../src/ports/favorites/lists'
import {
  DuplicatedListError,
  ListNotFoundError,
  ListsNotFoundError,
  PickAlreadyExistsError,
  PickNotFoundError,
  QueryFailure
} from '../../src/ports/favorites/lists/errors'
import { DBGetFilteredPicksWithCount, DBPick } from '../../src/ports/favorites/picks'
import { ISnapshotComponent } from '../../src/ports/favorites/snapshot'
import { ScoreError } from '../../src/ports/favorites/snapshot/errors'
import { createTestSnapshotComponent, createTestPgComponent, createTestItemsComponent, createTestLogsComponent } from '../components'

let listId: string
let itemId: string
let userAddress: string
let dbQueryMock: jest.Mock
let dbClientQueryMock: jest.Mock
let dbClientReleaseMock: jest.Mock
let getScoreMock: jest.Mock
let validateItemExistsMock: jest.Mock
let pg: IPgComponent & IDatabase
let listsComponent: IListsComponents
let items: IItemsComponent
let snapshot: ISnapshotComponent
let logs: ILoggerComponent

beforeEach(() => {
  dbQueryMock = jest.fn()
  validateItemExistsMock = jest.fn()
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
        await onError(error)
        throw error
      }
    })
  })
  logs = createTestLogsComponent({
    getLogger: jest.fn().mockReturnValue({ error: () => undefined, info: () => undefined })
  })
  snapshot = createTestSnapshotComponent({ getScore: getScoreMock })
  items = createTestItemsComponent({
    validateItemExists: validateItemExistsMock
  })
  listsComponent = createListsComponent({
    favoritesDatabase: pg,
    items,
    logs,
    snapshot
  })
  listId = '99ffdcd4-0647-41e7-a865-996e2071ed62'
  itemId = '0x08de0de733cc11081d43569b809c00e6ddf314fb-0'
  userAddress = '0x1dec5f50cb1467f505bb3ddfd408805114406b10'
})

describe('when getting picks from a list by list id', () => {
  let dbGetPicksByListId: DBGetFilteredPicksWithCount[]

  describe('and the query throws an error', () => {
    const errorMessage = 'Something went wrong while querying the database'

    beforeEach(() => {
      dbQueryMock.mockRejectedValueOnce(new Error(errorMessage))
    })

    it('should propagate the error', () => {
      expect(
        listsComponent.getPicksByListId('list-id', {
          offset: 0,
          limit: 10,
          userAddress: '0xuseraddress'
        })
      ).rejects.toThrowError(errorMessage)
    })
  })

  describe('and the list id, limit, offset, and user address are all set', () => {
    beforeEach(() => {
      dbGetPicksByListId = []
      dbQueryMock.mockResolvedValueOnce({ rows: dbGetPicksByListId })
    })

    it('should have made the query to get the picks matching those conditions', async () => {
      await expect(
        listsComponent.getPicksByListId('list-id', {
          offset: 0,
          limit: 10,
          userAddress: '0xuseraddress'
        })
      ).resolves.toEqual(dbGetPicksByListId)

      expect(dbQueryMock).toBeCalledWith(
        expect.objectContaining({
          strings: expect.arrayContaining([
            expect.stringContaining('WHERE p.list_id ='),
            expect.stringContaining('AND (p.user_address ='),
            expect.stringContaining('OR favorites.acl.grantee ='),
            expect.stringContaining('OR favorites.acl.grantee =')
          ]),
          values: expect.arrayContaining(['list-id', '0xuseraddress', '0xuseraddress', '*'])
        })
      )

      expect(dbQueryMock).toBeCalledWith(
        expect.objectContaining({
          strings: expect.arrayContaining([expect.stringContaining('LIMIT'), expect.stringContaining('OFFSET')]),
          values: expect.arrayContaining([10, 0])
        })
      )
    })
  })
})

describe('when creating a new pick', () => {
  describe("and the user isn't allowed to create a new pick on the given list or the list doesn't exist", () => {
    let error: Error

    beforeEach(() => {
      error = new ListNotFoundError(listId)
      dbQueryMock.mockRejectedValueOnce(error)
    })

    it('should throw a list not found error', () => {
      return expect(listsComponent.addPickToList(listId, itemId, userAddress)).rejects.toEqual(error)
    })
  })

  describe('and the collections subgraph query fails', () => {
    beforeEach(() => {
      dbQueryMock.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'aListId',
            name: 'aListName',
            description: null,
            user_address: 'aUserAddress',
            permission: Permission.EDIT
          }
        ]
      })
      validateItemExistsMock.mockRejectedValueOnce(new QueryFailure('anError'))
    })

    it('should throw an error saying that the request failed', () => {
      return expect(listsComponent.addPickToList(listId, itemId, userAddress)).rejects.toEqual(new QueryFailure('anError'))
    })
  })

  describe("and the item being picked doesn't exist", () => {
    beforeEach(() => {
      dbQueryMock.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'aListId',
            name: 'aListName',
            description: null,
            user_address: 'aUserAddress',
            permission: Permission.EDIT
          }
        ]
      })
      getScoreMock.mockResolvedValueOnce(10)
      validateItemExistsMock.mockRejectedValueOnce(new ItemNotFoundError(itemId))
    })

    it('should throw an item not found error', () => {
      return expect(listsComponent.addPickToList(listId, itemId, userAddress)).rejects.toEqual(new ItemNotFoundError(itemId))
    })
  })

  describe('and the item being picked exists and the user is allowed to create a new pick on the given list', () => {
    beforeEach(() => {
      validateItemExistsMock.mockResolvedValueOnce({
        items: [{ id: itemId }]
      })
      dbQueryMock.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: listId,
            name: 'aListName',
            description: null,
            user_address: userAddress,
            permission: Permission.EDIT
          }
        ]
      })
    })

    describe('and the pick already exists', () => {
      beforeEach(() => {
        // Insert pick mock
        dbClientQueryMock.mockRejectedValueOnce({
          constraint: 'item_id_user_address_list_id_primary_key'
        })
        // Insert vp mock
        dbClientQueryMock.mockResolvedValueOnce(undefined)
      })

      it('should throw a pick already exists error', async () => {
        await expect(listsComponent.addPickToList(listId, itemId, userAddress)).rejects.toEqual(new PickAlreadyExistsError(listId, itemId))
      })
    })

    describe('and the pick does not exist already', () => {
      let dbPick: DBPick
      let result: DBPick

      beforeEach(() => {
        dbPick = {
          item_id: itemId,
          user_address: userAddress,
          list_id: listId,
          created_at: new Date()
        }
        dbClientQueryMock.mockResolvedValueOnce({
          rowCount: 1,
          rows: [dbPick]
        })
      })

      describe('and the request to get the voting power failed', () => {
        beforeEach(async () => {
          getScoreMock.mockRejectedValueOnce(new ScoreError('Unknown error getting the score', userAddress))
          result = await listsComponent.addPickToList(listId, itemId, userAddress)
        })

        it('should create the pick', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([expect.stringContaining('INSERT INTO favorites.picks (item_id, user_address, list_id)')]),
              values: [itemId, userAddress, listId]
            })
          )
        })

        it('should insert the voting power as 0 without overwriting it', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([expect.stringContaining('INSERT INTO favorites.voting (user_address, power) VALUES')]),
              values: [userAddress, 0]
            })
          )

          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([expect.stringContaining('ON CONFLICT (user_address) DO NOTHING')])
            })
          )
        })

        it('should resolve with the new pick', () => {
          expect(result).toEqual(dbPick)
        })
      })

      describe('and the request to get the voting power was successful', () => {
        beforeEach(async () => {
          getScoreMock.mockResolvedValueOnce(10)
          result = await listsComponent.addPickToList(listId, itemId, userAddress)
        })

        it('should create the pick', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([expect.stringContaining('INSERT INTO favorites.picks (item_id, user_address, list_id)')]),
              values: [itemId, userAddress, listId]
            })
          )
        })

        it('should insert the voting power or overwrite it', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([expect.stringContaining('INSERT INTO favorites.voting (user_address, power) VALUES')]),
              values: [userAddress, 10, 10]
            })
          )

          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([expect.stringContaining('ON CONFLICT (user_address) DO UPDATE SET power =')])
            })
          )
        })

        it('should resolve with the new pick', () => {
          expect(result).toEqual(dbPick)
        })
      })
    })
  })
})

describe('when deleting a pick', () => {
  describe('and the pick was not found or was not accessible by the user', () => {
    let error: Error

    beforeEach(() => {
      error = new PickNotFoundError(listId, itemId)
      dbQueryMock.mockResolvedValueOnce({ rowCount: 0 })
    })

    it('should throw a pick not found error', () => {
      return expect(listsComponent.deletePickInList(listId, itemId, userAddress)).rejects.toEqual(error)
    })
  })

  describe('and the pick was successfully deleted', () => {
    beforeEach(() => {
      dbQueryMock.mockResolvedValueOnce({ rowCount: 1 })
    })

    it('should resolve', () => {
      return expect(listsComponent.deletePickInList(listId, itemId, userAddress)).resolves.toEqual(undefined)
    })
  })
})

describe('when getting lists', () => {
  let dbGetLists: DBGetListsWithCount[]

  describe('and the query throws an error', () => {
    const errorMessage = 'Something went wrong while querying the database'

    beforeEach(() => {
      dbQueryMock.mockRejectedValueOnce(new Error(errorMessage))
    })

    it('should propagate the error', () => {
      expect(
        listsComponent.getLists({
          offset: 0,
          limit: 10,
          userAddress: '0xuseraddress'
        })
      ).rejects.toThrowError(errorMessage)
    })
  })

  describe('and the limit, offset, and user address are all set', () => {
    beforeEach(() => {
      dbGetLists = []
      dbQueryMock.mockResolvedValueOnce({ rows: dbGetLists })
    })

    describe('and the sorting parameters are not set', () => {
      it('should have made the query to get the lists using the default sorting parameters', async () => {
        await expect(
          listsComponent.getLists({
            offset: 0,
            limit: 10,
            userAddress: '0xuseraddress'
          })
        ).resolves.toEqual(dbGetLists)

        expect(dbQueryMock).toBeCalledWith(
          expect.objectContaining({
            strings: expect.arrayContaining([
              expect.stringContaining(
                '(SELECT COUNT(1) FROM favorites.acl WHERE favorites.acl.list_id = l.id AND (favorites.acl.grantee ='
              ),
              expect.stringContaining('OR favorites.acl.grantee ='),
              expect.stringContaining(')) = 0 AS is_private'),
              expect.stringContaining('LEFT JOIN favorites.picks p ON l.id = p.list_id AND p.user_address =')
            ]),
            values: expect.arrayContaining(['0xuseraddress', '0xuseraddress', '*'])
          })
        )

        expect(dbQueryMock).toBeCalledWith(
          expect.objectContaining({
            strings: expect.arrayContaining([
              expect.stringContaining('WHERE l.user_address ='),
              expect.stringContaining('OR l.user_address =')
            ]),
            values: expect.arrayContaining(['0xuseraddress', DEFAULT_LIST_USER_ADDRESS])
          })
        )

        expect(dbQueryMock).toBeCalledWith(
          expect.objectContaining({
            strings: expect.arrayContaining([expect.stringContaining('ORDER BY is_default_list DESC, l.created_at DESC')])
          })
        )

        expect(dbQueryMock).toBeCalledWith(
          expect.objectContaining({
            strings: expect.arrayContaining([expect.stringContaining('LIMIT'), expect.stringContaining('OFFSET')]),
            values: expect.arrayContaining([10, 0])
          })
        )
      })
    })

    describe('and the item id parameter is set', () => {
      let itemId: string

      beforeEach(() => {
        itemId = '0x08de0de733cc11081d43569b809c00e6ddf314fb-0'
      })

      it('should have made the query to get the lists taking into account if the item is in the list', async () => {
        await expect(
          listsComponent.getLists({
            offset: 0,
            limit: 10,
            userAddress: '0xuseraddress',
            itemId
          })
        ).resolves.toEqual(dbGetLists)

        expect(dbQueryMock).toBeCalledWith(
          expect.objectContaining({
            text: expect.stringContaining(', MAX(CASE WHEN p.item_id = $4 THEN 1 ELSE 0 END)::BOOLEAN AS is_item_in_list'),
            values: expect.arrayContaining([itemId])
          })
        )
      })
    })

    describe('and the q parameter is set', () => {
      let q: string

      beforeEach(() => {
        q = 'aName'
      })

      it('should have made the query to get the lists searching by the list names', async () => {
        await expect(
          listsComponent.getLists({
            offset: 0,
            limit: 10,
            userAddress: '0xuseraddress',
            q
          })
        ).resolves.toEqual(dbGetLists)

        expect(dbQueryMock).toBeCalledWith(
          expect.objectContaining({
            text: expect.stringContaining("AND l.name ILIKE '%$7%'"),
            values: expect.arrayContaining([q])
          })
        )
      })
    })

    describe.each([
      [ListSortBy.CREATED_AT, 'created_at', ''],
      [ListSortBy.NAME, 'name', ''],
      [ListSortBy.UPDATED_AT, 'updated_at', 'NULLS LAST']
    ])('and the sorting parameters are set', (sortBy, expectedOrderByColumn, extraStatement) => {
      describe('and the sort by is "%s"', () => {
        describe.each([ListSortDirection.ASC, ListSortDirection.DESC])('and the sort direction is "%s"', sortDirection => {
          it('should have made the query to get the lists matching those conditions', async () => {
            await expect(
              listsComponent.getLists({
                offset: 0,
                limit: 10,
                userAddress: '0xuseraddress',
                sortBy,
                sortDirection
              })
            ).resolves.toEqual(dbGetLists)

            expect(dbQueryMock).toBeCalledWith(
              expect.objectContaining({
                strings: expect.arrayContaining([
                  expect.stringContaining(
                    `ORDER BY is_default_list DESC, l.${expectedOrderByColumn} ${sortDirection.toUpperCase()} ${extraStatement}`.trim()
                  )
                ])
              })
            )

            expect(dbQueryMock).toBeCalledWith(
              expect.objectContaining({
                strings: expect.arrayContaining([expect.stringContaining('LIMIT'), expect.stringContaining('OFFSET')]),
                values: expect.arrayContaining([10, 0])
              })
            )
          })
        })
      })
    })
  })
})

describe('when creating a new list', () => {
  let name: string

  beforeEach(() => {
    name = 'Test List'
  })

  describe('and there is already a list created with the same name', () => {
    beforeEach(() => {
      // Insert List Mock Query
      dbClientQueryMock.mockRejectedValueOnce({
        constraint: 'name_user_address_unique'
      })
    })

    it('should throw a duplicated list name error', async () => {
      await expect(listsComponent.addList({ name, userAddress, private: false })).rejects.toEqual(new DuplicatedListError(name))
    })
  })

  describe('and the insert query fails with an unexpected error', () => {
    beforeEach(() => {
      // Insert List Mock Query
      dbClientQueryMock.mockRejectedValueOnce(new Error("Unexpected error when inserting the list's data"))
    })

    it('should throw a generic error', async () => {
      await expect(listsComponent.addList({ name, userAddress, private: false })).rejects.toEqual(new Error("The list couldn't be created"))
    })
  })

  describe('and the access query fails with an unexpected error', () => {
    beforeEach(() => {
      // Insert List Mock Query
      dbClientQueryMock.mockResolvedValueOnce({ rows: [{ id: listId }] })

      // Access Mock Query
      dbClientQueryMock.mockRejectedValueOnce(new Error("Unexpected error when inserting the list's data"))
    })

    it('should throw a generic error', async () => {
      await expect(listsComponent.addList({ name, userAddress, private: false })).rejects.toEqual(new Error("The list couldn't be created"))
    })
  })

  describe('and there are no lists with the same name', () => {
    let dbList: DBList
    let result: DBList

    beforeEach(() => {
      dbList = {
        id: listId,
        name,
        user_address: userAddress,
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
        is_private: true
      }

      // Create List Query
      dbClientQueryMock.mockResolvedValueOnce({
        rowCount: 1,
        rows: [dbList]
      })
    })

    describe('and the list should be private', () => {
      beforeEach(async () => {
        // Access Mock Query
        dbClientQueryMock.mockResolvedValueOnce({ rowCount: 1 })

        result = await listsComponent.addList({ name, userAddress, private: true })
      })

      it('should create the list', () => {
        expect(dbClientQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            strings: expect.arrayContaining([expect.stringContaining('INSERT INTO favorites.lists (name, description, user_address)')]),
            values: [name, null, userAddress]
          })
        )
      })

      it('should not insert a new access to make the list public', () => {
        expect(dbClientQueryMock).not.toHaveBeenCalledWith(
          expect.objectContaining({
            strings: expect.arrayContaining([expect.stringContaining('INSERT INTO favorites.acl (list_id, permission, grantee) VALUES')])
          })
        )
      })

      it('should resolve with the new list', () => {
        expect(result).toEqual({ ...dbList, is_private: true })
      })
    })

    describe('and the list should be public', () => {
      beforeEach(async () => {
        // Access Mock Query
        dbClientQueryMock.mockResolvedValueOnce(undefined)

        result = await listsComponent.addList({ name, userAddress, private: false })
      })

      it('should create the list', () => {
        expect(dbClientQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            strings: expect.arrayContaining([expect.stringContaining('INSERT INTO favorites.lists (name, description, user_address)')]),
            values: [name, null, userAddress]
          })
        )
      })

      it('should insert a new access to make the list public', () => {
        expect(dbClientQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            strings: expect.arrayContaining([expect.stringContaining('INSERT INTO favorites.acl (list_id, permission, grantee) VALUES')]),
            values: [listId, Permission.VIEW, '*']
          })
        )
      })

      it('should resolve with the new list', () => {
        expect(result).toEqual({ ...dbList, is_private: false })
      })
    })
  })
})

describe('when deleting a list', () => {
  describe('and the list was not found or was not accessible by the user', () => {
    let error: Error

    beforeEach(() => {
      error = new ListNotFoundError(listId)
      dbQueryMock.mockResolvedValueOnce({ rowCount: 0 })
    })

    it('should throw a list not found error', () => {
      return expect(listsComponent.deleteList(listId, userAddress)).rejects.toEqual(error)
    })
  })

  describe('and the list was successfully deleted', () => {
    let result: void

    beforeEach(async () => {
      dbQueryMock.mockResolvedValueOnce({ rowCount: 1 })
      result = await listsComponent.deleteList(listId, userAddress)
    })

    it('should have made the query to delete the list', () => {
      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('DELETE FROM favorites.lists')
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('WHERE favorites.lists.id = $1'),
          values: expect.arrayContaining([listId])
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('AND favorites.lists.user_address = $2'),
          values: expect.arrayContaining([userAddress])
        })
      )
    })

    it('should resolve', () => {
      return expect(result).toEqual(undefined)
    })
  })
})

describe('when getting a list', () => {
  describe('and the list was not found or was not accessible by the user', () => {
    let error: Error

    beforeEach(() => {
      error = new ListNotFoundError(listId)
      dbQueryMock.mockResolvedValueOnce({ rowCount: 0 })
    })

    it('should throw a list not found error', () => {
      return expect(listsComponent.getList(listId, { userAddress })).rejects.toEqual(error)
    })
  })

  describe('and the default list is the one retrieved', () => {
    let dbList: DBList
    let result: DBList

    beforeEach(async () => {
      dbList = {
        id: DEFAULT_LIST_ID,
        name: 'aListName',
        description: null,
        user_address: 'aUserAddress',
        created_at: new Date(),
        updated_at: new Date(),
        is_private: false
      }

      dbQueryMock.mockResolvedValueOnce({ rowCount: 1, rows: [dbList] })
      result = await listsComponent.getList(DEFAULT_LIST_ID, { userAddress })
    })

    it('should return as the updated at the last time this user picked an item for the default list', () => {
      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('MAX(favorites.picks.created_at) as updated_at')
        })
      )
    })

    it('should resolve with the list', () => {
      return expect(result).toEqual(dbList)
    })
  })

  describe('and neither the default list nor the permissions should be considered', () => {
    let dbList: DBList
    let result: DBList

    beforeEach(async () => {
      dbList = {
        id: 'aListId',
        name: 'aListName',
        description: null,
        user_address: 'aUserAddress',
        created_at: new Date(),
        updated_at: new Date(),
        is_private: false
      }

      dbQueryMock.mockResolvedValueOnce({ rowCount: 1, rows: [dbList] })
      result = await listsComponent.getList(listId, { userAddress, considerDefaultList: false })
    })

    it('should have made the query to get without checking if the list belongs to the default user or if has the required permissions', () => {
      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining(
            'SELECT favorites.lists.id, favorites.lists.name, favorites.lists.description, favorites.lists.user_address, favorites.lists.created_at, favorites.lists.updated_at, favorites.acl.permission AS permission, COUNT(favorites.picks.item_id) AS items_count, COUNT(favorites.acl.permission) = 0 AS is_private'
          )
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining(
            '(ARRAY_REMOVE(ARRAY_AGG(favorites.picks.item_id ORDER BY favorites.picks.created_at), NULL))[:4] AS preview_of_item_ids'
          )
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('FROM favorites.lists')
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining(
            'LEFT JOIN favorites.picks ON favorites.lists.id = favorites.picks.list_id AND (favorites.picks.user_address = $1 OR favorites.picks.user_address = favorites.lists.user_address)'
          ),
          values: expect.arrayContaining([userAddress])
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('LEFT JOIN favorites.acl ON favorites.lists.id = favorites.acl.list_id')
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('WHERE favorites.lists.id = $2 AND'),
          values: expect.arrayContaining([listId])
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('(favorites.lists.user_address = $3)'),
          values: expect.arrayContaining([userAddress])
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('GROUP BY favorites.lists.id, favorites.acl.permission')
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('ORDER BY favorites.acl.permission ASC LIMIT 1')
        })
      )
    })

    it('should resolve with the list', () => {
      return expect(result).toEqual(dbList)
    })
  })

  describe('and the default list should be considered but not the permissions', () => {
    let dbList: DBList
    let result: DBList

    beforeEach(async () => {
      dbList = {
        id: 'aListId',
        name: 'aListName',
        description: null,
        user_address: 'aUserAddress',
        created_at: new Date(),
        updated_at: new Date(),
        is_private: false
      }

      dbQueryMock.mockResolvedValueOnce({ rowCount: 1, rows: [dbList] })
      result = await listsComponent.getList(listId, { userAddress, considerDefaultList: true })
    })

    it('should have made the query to get the list checking if the list belongs to the default user without taking into account the permissions', () => {
      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining(
            'SELECT favorites.lists.id, favorites.lists.name, favorites.lists.description, favorites.lists.user_address, favorites.lists.created_at, favorites.lists.updated_at, favorites.acl.permission AS permission, COUNT(favorites.picks.item_id) AS items_count, COUNT(favorites.acl.permission) = 0 AS is_private'
          )
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining(
            '(ARRAY_REMOVE(ARRAY_AGG(favorites.picks.item_id ORDER BY favorites.picks.created_at), NULL))[:4] AS preview_of_item_ids'
          )
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('FROM favorites.lists')
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining(
            'LEFT JOIN favorites.picks ON favorites.lists.id = favorites.picks.list_id AND (favorites.picks.user_address = $1 OR favorites.picks.user_address = favorites.lists.user_address)'
          ),
          values: expect.arrayContaining([userAddress])
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('LEFT JOIN favorites.acl ON favorites.lists.id = favorites.acl.list_id')
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('WHERE favorites.lists.id = $2 AND'),
          values: expect.arrayContaining([listId])
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('(favorites.lists.user_address = $3 OR favorites.lists.user_address = $4)'),
          values: expect.arrayContaining([userAddress, DEFAULT_LIST_USER_ADDRESS])
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('GROUP BY favorites.lists.id, favorites.acl.permission')
        })
      )

      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('ORDER BY favorites.acl.permission ASC LIMIT 1')
        })
      )
    })

    it('should resolve with the list', () => {
      return expect(result).toEqual(dbList)
    })
  })

  describe('and both the default list and the permissions should be considered', () => {
    let dbList: DBList
    let result: DBList

    beforeEach(() => {
      dbList = {
        id: 'aListId',
        name: 'aListName',
        description: null,
        user_address: 'aUserAddress',
        created_at: new Date(),
        updated_at: new Date(),
        is_private: false
      }
    })

    describe('and the required permission is EDIT', () => {
      let permission: Permission

      beforeEach(async () => {
        permission = Permission.EDIT

        dbList = {
          ...dbList,
          permission
        }

        dbQueryMock.mockResolvedValueOnce({ rowCount: 1, rows: [dbList] })
        result = await listsComponent.getList(listId, { userAddress, considerDefaultList: true, requiredPermission: permission })
      })

      it('should have made the query to get the list matching the permission conditions', () => {
        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining(
              'SELECT favorites.lists.id, favorites.lists.name, favorites.lists.description, favorites.lists.user_address, favorites.lists.created_at, favorites.lists.updated_at, favorites.acl.permission AS permission, COUNT(favorites.picks.item_id) AS items_count, COUNT(favorites.acl.permission) = 0 AS is_private'
            )
          })
        )

        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining(
              '(ARRAY_REMOVE(ARRAY_AGG(favorites.picks.item_id ORDER BY favorites.picks.created_at), NULL))[:4] AS preview_of_item_ids'
            )
          })
        )

        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('FROM favorites.lists')
          })
        )

        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining(
              'LEFT JOIN favorites.picks ON favorites.lists.id = favorites.picks.list_id AND (favorites.picks.user_address = $1 OR favorites.picks.user_address = favorites.lists.user_address)'
            ),
            values: expect.arrayContaining([userAddress])
          })
        )

        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('LEFT JOIN favorites.acl ON favorites.lists.id = favorites.acl.list_id')
          })
        )

        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining(
              'WHERE favorites.lists.id = $2 AND (favorites.lists.user_address = $3 OR favorites.lists.user_address = $4 OR ((favorites.acl.grantee = $5 OR favorites.acl.grantee = $6) AND favorites.acl.permission = ANY($7))'
            ),
            values: expect.arrayContaining([listId, userAddress, DEFAULT_LIST_USER_ADDRESS, userAddress, '*', [permission]])
          })
        )

        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('GROUP BY favorites.lists.id, favorites.acl.permission')
          })
        )

        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('ORDER BY favorites.acl.permission ASC LIMIT 1')
          })
        )
      })

      it('should resolve with the list', () => {
        return expect(result).toEqual(dbList)
      })
    })

    describe('and the required permission is VIEW', () => {
      let permission: Permission

      beforeEach(async () => {
        permission = Permission.VIEW

        dbList = {
          ...dbList,
          permission
        }

        dbQueryMock.mockResolvedValueOnce({ rowCount: 1, rows: [dbList] })
        result = await listsComponent.getList(listId, { userAddress, considerDefaultList: true, requiredPermission: permission })
      })

      it('should have made the query to get the list matching the permission conditions', () => {
        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining(
              'SELECT favorites.lists.id, favorites.lists.name, favorites.lists.description, favorites.lists.user_address, favorites.lists.created_at, favorites.lists.updated_at, favorites.acl.permission AS permission, COUNT(favorites.picks.item_id) AS items_count, COUNT(favorites.acl.permission) = 0 AS is_private'
            )
          })
        )

        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining(
              '(ARRAY_REMOVE(ARRAY_AGG(favorites.picks.item_id ORDER BY favorites.picks.created_at), NULL))[:4] AS preview_of_item_ids'
            )
          })
        )

        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('FROM favorites.lists')
          })
        )

        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining(
              'LEFT JOIN favorites.picks ON favorites.lists.id = favorites.picks.list_id AND (favorites.picks.user_address = $1 OR favorites.picks.user_address = favorites.lists.user_address)'
            ),
            values: expect.arrayContaining([userAddress])
          })
        )

        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('LEFT JOIN favorites.acl ON favorites.lists.id = favorites.acl.list_id')
          })
        )

        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining(
              'WHERE favorites.lists.id = $2 AND (favorites.lists.user_address = $3 OR favorites.lists.user_address = $4 OR ((favorites.acl.grantee = $5 OR favorites.acl.grantee = $6) AND favorites.acl.permission = ANY($7)))'
            ),
            values: expect.arrayContaining([
              listId,
              userAddress,
              DEFAULT_LIST_USER_ADDRESS,
              userAddress,
              '*',
              [permission, Permission.EDIT]
            ])
          })
        )

        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('GROUP BY favorites.lists.id, favorites.acl.permission')
          })
        )

        expect(dbQueryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('ORDER BY favorites.acl.permission ASC LIMIT 1')
          })
        )
      })

      it('should resolve with the list', () => {
        return expect(result).toEqual(dbList)
      })
    })
  })
})

describe('when updating a list', () => {
  let updatedList: UpdateListRequestBody
  let name: string

  beforeEach(() => {
    name = 'Updated List Name'
    updatedList = {
      name,
      description: 'Updated List Description'
    }
  })

  describe('and the list does not exist', () => {
    beforeEach(() => {
      // Update List Mock Query
      dbClientQueryMock.mockResolvedValueOnce({ rowCount: 0 })

      // Access Mock Query
      dbClientQueryMock.mockResolvedValueOnce(undefined)

      // Get Updated List Mock Query
      dbClientQueryMock.mockResolvedValueOnce({ rowCount: 0 })
    })

    it('should throw a list not found error', async () => {
      await expect(listsComponent.updateList(listId, userAddress, updatedList)).rejects.toEqual(new ListNotFoundError(listId))
    })
  })

  describe('and the list name is being duplicated', () => {
    beforeEach(() => {
      // Update List Mock Query
      dbClientQueryMock.mockRejectedValueOnce({ constraint: 'name_user_address_unique' })

      // Access Mock Query
      dbClientQueryMock.mockResolvedValueOnce(undefined)
    })

    it('should throw a duplicated list error', async () => {
      await expect(listsComponent.updateList(listId, userAddress, updatedList)).rejects.toEqual(new DuplicatedListError(name))
    })
  })

  describe('and the update or select query fails because of an unexpected error', () => {
    beforeEach(() => {
      // Update List Mock Query
      dbClientQueryMock.mockRejectedValueOnce(new Error('Unexpected Error'))
    })

    it('should throw a generic error', async () => {
      await expect(listsComponent.updateList(listId, userAddress, updatedList)).rejects.toEqual(new Error("The list couldn't be updated"))
    })
  })

  describe('and the access query fails because of an unexpected error', () => {
    beforeEach(() => {
      // Update List Mock Query
      dbClientQueryMock.mockResolvedValueOnce({ rowCount: 1 })

      // Access Mock Query
      dbClientQueryMock.mockRejectedValueOnce(new Error('Unexpected Error'))
    })

    it('should throw a generic error', async () => {
      await expect(listsComponent.updateList(listId, userAddress, updatedList)).rejects.toEqual(new Error("The list couldn't be updated"))
    })
  })

  describe('and setting the list as private', () => {
    beforeEach(() => {
      updatedList = {
        ...updatedList,
        private: true
      }
    })

    describe('and the lists exists but the access to be removed does not', () => {
      beforeEach(() => {
        // Update List Mock Query
        dbClientQueryMock.mockResolvedValueOnce({ rowCount: 1, rows: [updatedList] })

        // Delete Access Mock Query
        dbClientQueryMock.mockResolvedValueOnce({ rowCount: 0 })

        // Get Updated List Mock Query
        dbClientQueryMock.mockResolvedValueOnce({ rowCount: 1, rows: [updatedList] })
      })

      it('should not throw an error because this means the list is already private', () => {
        expect(() => listsComponent.updateList(listId, userAddress, updatedList)).not.toThrow(
          new AccessNotFoundError(listId, Permission.VIEW, '*')
        )
      })
    })

    describe('and the query succeeds', () => {
      let dbList: DBList
      let result: DBList

      beforeEach(async () => {
        dbList = {
          id: listId,
          name: 'aListName',
          description: null,
          user_address: userAddress,
          created_at: new Date(),
          updated_at: new Date(),
          is_private: false
        }

        // Update List Mock Query
        dbClientQueryMock.mockResolvedValueOnce({
          rowCount: 1,
          rows: [dbList]
        })

        // Delete Access Mock Query
        dbClientQueryMock.mockResolvedValueOnce({ rowCount: 1 })

        // Get Updated List Mock Query
        dbClientQueryMock.mockResolvedValueOnce({
          rowCount: 1,
          rows: [dbList]
        })
      })

      describe('and the updated list has only an updated name without a new description', () => {
        beforeEach(async () => {
          result = await listsComponent.updateList(listId, userAddress, { ...updatedList, description: undefined })
        })

        it('should update the list', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([
                expect.stringContaining('UPDATE favorites.lists SET'),
                expect.stringContaining('name ='),
                expect.stringContaining('WHERE id ='),
                expect.stringContaining('AND user_address ='),
                expect.stringContaining('RETURNING *')
              ]),
              values: [updatedList.name, listId, userAddress]
            })
          )
        })

        it('should delete the previous access to make the list private', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([
                expect.stringContaining('DELETE FROM favorites.acl USING favorites.lists'),
                expect.stringContaining('WHERE favorites.acl.list_id = favorites.lists.id'),
                expect.stringContaining('AND favorites.acl.list_id ='),
                expect.stringContaining('AND favorites.lists.user_address ='),
                expect.stringContaining('AND favorites.acl.permission ='),
                expect.stringContaining('AND favorites.acl.grantee =')
              ]),
              values: [listId, userAddress, Permission.VIEW, '*']
            })
          )
        })

        it('should resolve with the updated list', () => {
          expect(result).toEqual(dbList)
        })
      })

      describe('and the updated list has only an updated description without a new name', () => {
        beforeEach(async () => {
          result = await listsComponent.updateList(listId, userAddress, { ...updatedList, name: undefined })
        })

        it('should update the list', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([
                expect.stringContaining('UPDATE favorites.lists SET'),
                expect.stringContaining('description ='),
                expect.stringContaining('WHERE id ='),
                expect.stringContaining('AND user_address ='),
                expect.stringContaining('RETURNING *')
              ]),
              values: [updatedList.description, listId, userAddress]
            })
          )
        })

        it('should delete the previous access to make the list private', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([
                expect.stringContaining('DELETE FROM favorites.acl USING favorites.lists'),
                expect.stringContaining('WHERE favorites.acl.list_id = favorites.lists.id'),
                expect.stringContaining('AND favorites.acl.list_id ='),
                expect.stringContaining('AND favorites.lists.user_address ='),
                expect.stringContaining('AND favorites.acl.permission ='),
                expect.stringContaining('AND favorites.acl.grantee =')
              ]),
              values: [listId, userAddress, Permission.VIEW, '*']
            })
          )
        })

        it('should resolve with the updated list', () => {
          expect(result).toEqual(dbList)
        })
      })

      describe('and the updated list has both an updated name and description', () => {
        beforeEach(async () => {
          result = await listsComponent.updateList(listId, userAddress, updatedList)
        })

        it('should update the list', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([
                expect.stringContaining('UPDATE favorites.lists SET'),
                expect.stringContaining('name ='),
                expect.stringContaining(', description ='),
                expect.stringContaining('WHERE id ='),
                expect.stringContaining('AND user_address ='),
                expect.stringContaining('RETURNING *')
              ]),
              values: [updatedList.name, updatedList.description, listId, userAddress]
            })
          )
        })

        it('should delete the previous access to make the list private', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([
                expect.stringContaining('DELETE FROM favorites.acl USING favorites.lists'),
                expect.stringContaining('WHERE favorites.acl.list_id = favorites.lists.id'),
                expect.stringContaining('AND favorites.acl.list_id ='),
                expect.stringContaining('AND favorites.lists.user_address ='),
                expect.stringContaining('AND favorites.acl.permission ='),
                expect.stringContaining('AND favorites.acl.grantee =')
              ]),
              values: [listId, userAddress, Permission.VIEW, '*']
            })
          )
        })

        it('should resolve with the updated list', () => {
          expect(result).toEqual(dbList)
        })
      })
    })
  })

  describe('and setting the list as public', () => {
    beforeEach(() => {
      updatedList = {
        ...updatedList,
        private: false
      }
    })

    describe('and the query succeeds', () => {
      let dbList: DBList
      let result: DBList

      beforeEach(() => {
        dbList = {
          id: listId,
          name: 'aListName',
          description: null,
          user_address: userAddress,
          created_at: new Date(),
          updated_at: new Date(),
          is_private: true
        }

        // Update List Mock Query
        dbClientQueryMock.mockResolvedValueOnce({
          rowCount: 1,
          rows: [dbList]
        })

        // Delete Access Mock Query
        dbClientQueryMock.mockResolvedValueOnce({ rowCount: 1 })

        // Get Updated List Mock Query
        dbClientQueryMock.mockResolvedValueOnce({
          rowCount: 1,
          rows: [dbList]
        })
      })

      describe('and the updated list has only an updated name without a new description', () => {
        beforeEach(async () => {
          result = await listsComponent.updateList(listId, userAddress, { ...updatedList, description: undefined })
        })

        it('should update the list', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([
                expect.stringContaining('UPDATE favorites.lists SET'),
                expect.stringContaining('name ='),
                expect.stringContaining('WHERE id ='),
                expect.stringContaining('AND user_address ='),
                expect.stringContaining('RETURNING *')
              ]),
              values: [updatedList.name, listId, userAddress]
            })
          )
        })

        it('should insert a new access to make the list public', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([expect.stringContaining('INSERT INTO favorites.acl (list_id, permission, grantee) VALUES')]),
              values: [listId, Permission.VIEW, '*']
            })
          )
        })

        it('should resolve with the updated list', () => {
          expect(result).toEqual(dbList)
        })
      })

      describe('and the updated list has only an updated description without a new name', () => {
        beforeEach(async () => {
          result = await listsComponent.updateList(listId, userAddress, { ...updatedList, name: undefined })
        })

        it('should update the list', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([
                expect.stringContaining('UPDATE favorites.lists SET'),
                expect.stringContaining('description ='),
                expect.stringContaining('WHERE id ='),
                expect.stringContaining('AND user_address ='),
                expect.stringContaining('RETURNING *')
              ]),
              values: [updatedList.description, listId, userAddress]
            })
          )
        })

        it('should insert a new access to make the list public', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([expect.stringContaining('INSERT INTO favorites.acl (list_id, permission, grantee) VALUES')]),
              values: [listId, Permission.VIEW, '*']
            })
          )
        })

        it('should get the updated list with its last privacy configuration', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([
                expect.stringContaining(
                  'SELECT favorites.lists.id, favorites.lists.name, favorites.lists.description, favorites.lists.user_address, favorites.lists.created_at, favorites.lists.updated_at, favorites.acl.permission AS permission, COUNT(favorites.picks.item_id) AS items_count, COUNT(favorites.acl.permission) = 0 AS is_private'
                ),
                expect.stringContaining(
                  '(ARRAY_REMOVE(ARRAY_AGG(favorites.picks.item_id ORDER BY favorites.picks.created_at), NULL))[:4] AS preview_of_item_ids'
                ),
                expect.stringContaining('FROM favorites.lists'),
                expect.stringContaining(
                  'LEFT JOIN favorites.picks ON favorites.lists.id = favorites.picks.list_id AND (favorites.picks.user_address ='
                ),
                expect.stringContaining('OR favorites.picks.user_address = favorites.lists.user_address)'),
                expect.stringContaining('LEFT JOIN favorites.acl ON favorites.lists.id = favorites.acl.list_id'),
                expect.stringContaining('WHERE favorites.lists.id ='),
                expect.stringContaining('(favorites.lists.user_address ='),
                expect.stringContaining('OR favorites.lists.user_address ='),
                expect.stringContaining(')'),
                expect.stringContaining('GROUP BY favorites.lists.id, favorites.acl.permission'),
                expect.stringContaining('ORDER BY favorites.acl.permission ASC LIMIT 1')
              ]),
              values: [userAddress, listId, userAddress, DEFAULT_LIST_USER_ADDRESS]
            })
          )
        })

        it('should resolve with the updated list', () => {
          expect(result).toEqual(dbList)
        })
      })

      describe('and the updated list has both an updated name and description', () => {
        beforeEach(async () => {
          result = await listsComponent.updateList(listId, userAddress, updatedList)
        })

        it('should update the list', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([
                expect.stringContaining('UPDATE favorites.lists SET'),
                expect.stringContaining('name ='),
                expect.stringContaining(', description ='),
                expect.stringContaining('WHERE id ='),
                expect.stringContaining('AND user_address ='),
                expect.stringContaining('RETURNING *')
              ]),
              values: [updatedList.name, updatedList.description, listId, userAddress]
            })
          )
        })

        it('should insert a new access to make the list public', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([expect.stringContaining('INSERT INTO favorites.acl (list_id, permission, grantee) VALUES')]),
              values: [listId, Permission.VIEW, '*']
            })
          )
        })

        it('should get the updated list with its last privacy configuration', () => {
          expect(dbClientQueryMock).toHaveBeenCalledWith(
            expect.objectContaining({
              strings: expect.arrayContaining([
                expect.stringContaining(
                  'SELECT favorites.lists.id, favorites.lists.name, favorites.lists.description, favorites.lists.user_address, favorites.lists.created_at, favorites.lists.updated_at, favorites.acl.permission AS permission, COUNT(favorites.picks.item_id) AS items_count, COUNT(favorites.acl.permission) = 0 AS is_private'
                ),
                expect.stringContaining(
                  '(ARRAY_REMOVE(ARRAY_AGG(favorites.picks.item_id ORDER BY favorites.picks.created_at), NULL))[:4] AS preview_of_item_ids'
                ),
                expect.stringContaining('FROM favorites.lists'),
                expect.stringContaining(
                  'LEFT JOIN favorites.picks ON favorites.lists.id = favorites.picks.list_id AND (favorites.picks.user_address ='
                ),
                expect.stringContaining('OR favorites.picks.user_address = favorites.lists.user_address)'),
                expect.stringContaining('LEFT JOIN favorites.acl ON favorites.lists.id = favorites.acl.list_id'),
                expect.stringContaining('WHERE favorites.lists.id ='),
                expect.stringContaining('(favorites.lists.user_address ='),
                expect.stringContaining('OR favorites.lists.user_address ='),
                expect.stringContaining(')'),
                expect.stringContaining('GROUP BY favorites.lists.id, favorites.acl.permission'),
                expect.stringContaining('ORDER BY favorites.acl.permission ASC LIMIT 1')
              ]),
              values: [userAddress, listId, userAddress, DEFAULT_LIST_USER_ADDRESS]
            })
          )
        })

        it('should resolve with the updated list', () => {
          expect(result).toEqual(dbList)
        })
      })
    })
  })

  describe('and nothing is being updated besides the access', () => {
    let dbList: DBList
    let result: DBList

    beforeEach(async () => {
      updatedList = {
        ...updatedList,
        name: undefined,
        description: undefined
      }

      dbList = {
        id: listId,
        name: 'aListName',
        description: null,
        user_address: userAddress,
        created_at: new Date(),
        updated_at: new Date(),
        is_private: false
      }

      // Delete Access Mock Query
      dbClientQueryMock.mockResolvedValueOnce({ rowCount: 1 })

      // Get Updated List Mock Query
      dbClientQueryMock.mockResolvedValueOnce({
        rowCount: 1,
        rows: [dbList]
      })

      result = await listsComponent.updateList(listId, userAddress, updatedList)
    })

    it('should only get the list instead of updating it', () => {
      expect(dbClientQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          strings: expect.arrayContaining([
            expect.stringContaining(
              'SELECT favorites.lists.id, favorites.lists.name, favorites.lists.description, favorites.lists.user_address, favorites.lists.created_at, favorites.lists.updated_at, favorites.acl.permission AS permission, COUNT(favorites.picks.item_id) AS items_count, COUNT(favorites.acl.permission) = 0 AS is_private'
            ),
            expect.stringContaining(
              '(ARRAY_REMOVE(ARRAY_AGG(favorites.picks.item_id ORDER BY favorites.picks.created_at), NULL))[:4] AS preview_of_item_ids'
            ),
            expect.stringContaining('FROM favorites.lists'),
            expect.stringContaining(
              'LEFT JOIN favorites.picks ON favorites.lists.id = favorites.picks.list_id AND (favorites.picks.user_address ='
            ),
            expect.stringContaining('OR favorites.picks.user_address = favorites.lists.user_address)'),
            expect.stringContaining('LEFT JOIN favorites.acl ON favorites.lists.id = favorites.acl.list_id'),
            expect.stringContaining('WHERE favorites.lists.id ='),
            expect.stringContaining('(favorites.lists.user_address ='),
            expect.stringContaining('OR favorites.lists.user_address ='),
            expect.stringContaining(')'),
            expect.stringContaining('GROUP BY favorites.lists.id, favorites.acl.permission'),
            expect.stringContaining('ORDER BY favorites.acl.permission ASC LIMIT 1')
          ]),
          values: [userAddress, listId, userAddress, DEFAULT_LIST_USER_ADDRESS]
        })
      )
    })

    it('should resolve with the updated list', () => {
      expect(result).toEqual(dbList)
    })
  })
})

describe('when checking if a user is allowed to edit some lists', () => {
  const listIds: string[] = ['list-id-1', 'list-id-2', 'list-id-3']

  describe('and there are some lists in which the user is not the owner and does not have edit permission', () => {
    beforeEach(() => {
      dbQueryMock.mockResolvedValueOnce({ rows: [listIds[1]], rowCount: 1 })
    })

    it('should throw a lists not found error', () => {
      expect(listsComponent.checkNonEditableLists(listIds, userAddress)).rejects.toThrowError(new ListsNotFoundError([listIds[1]]))
    })
  })

  describe('and there are no lists in which the user cannot perform an edit', () => {
    beforeEach(() => {
      dbQueryMock.mockResolvedValueOnce({ rowCount: 0 })
    })

    it('should resolve without any specific result', async () => {
      await expect(listsComponent.checkNonEditableLists(listIds, userAddress)).resolves.toEqual(undefined)

      expect(dbQueryMock).toBeCalledWith(
        expect.objectContaining({
          strings: expect.arrayContaining([
            expect.stringContaining('WHERE favorites.lists.id = ANY'),
            expect.stringContaining('favorites.lists.user_address !='),
            expect.stringContaining('favorites.acl.permission !='),
            expect.stringContaining('OR favorites.acl.grantee NOT IN')
          ]),
          values: expect.arrayContaining([listIds, userAddress, Permission.EDIT, userAddress, '*'])
        })
      )
    })
  })
})
