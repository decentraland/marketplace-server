import { ILoggerComponent } from '@well-known-components/interfaces'
import { IPgComponent } from '../../src/ports/db/types'
import { IAccessComponent, Permission, createAccessComponent } from '../../src/ports/favorites/access'
import { AccessNotFoundError, DuplicatedAccessError } from '../../src/ports/favorites/access/errors'
import { IListsComponents } from '../../src/ports/favorites/lists'
import { ListNotFoundError } from '../../src/ports/favorites/lists/errors'
import { createTestListsComponent, createTestLogsComponent, createTestPgComponent } from '../components'

let accessComponent: IAccessComponent
let loggerComponentMock: ILoggerComponent
let listsComponentMock: IListsComponents
let pgComponentMock: IPgComponent
let queryMock: jest.Mock
let getListMock: jest.Mock
let listId: string
let permission: Permission
let grantee: string
let listOwner: string

beforeEach(() => {
  queryMock = jest.fn()
  getListMock = jest.fn()
  pgComponentMock = createTestPgComponent({ query: queryMock })
  loggerComponentMock = createTestLogsComponent({ getLogger: jest.fn().mockReturnValue({ info: () => undefined }) })
  listsComponentMock = createTestListsComponent({ getList: getListMock })
  accessComponent = createAccessComponent({ favoritesDatabase: pgComponentMock, logs: loggerComponentMock, lists: listsComponentMock })
  listId = 'aListId'
  permission = Permission.VIEW
  grantee = '*'
  listOwner = 'anAddress'
})

describe('when deleting an access', () => {
  describe('and nothing got deleted', () => {
    beforeEach(() => {
      queryMock.mockResolvedValueOnce({ rowCount: 0 })
    })

    it('should return an access not found error', () => {
      return expect(accessComponent.deleteAccess(listId, permission, grantee, listOwner)).rejects.toEqual(
        new AccessNotFoundError(listId, permission, grantee)
      )
    })
  })

  describe('and an access got deleted', () => {
    beforeEach(async () => {
      queryMock.mockResolvedValueOnce({ rowCount: 1 })
      await accessComponent.deleteAccess(listId, permission, grantee, listOwner)
    })

    it('should delete the access taking into consideration the list id, the permission, the grantee and the list owner', () => {
      expect(queryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('AND favorites.acl.list_id = $1'),
          values: expect.arrayContaining([listId])
        })
      )

      expect(queryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('AND favorites.lists.user_address = $2'),
          values: expect.arrayContaining([listOwner])
        })
      )

      expect(queryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('AND favorites.acl.permission = $3'),
          values: expect.arrayContaining([permission])
        })
      )

      expect(queryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('AND favorites.acl.grantee = $4'),
          values: expect.arrayContaining([grantee])
        })
      )
    })
  })
})

describe('when creating an access', () => {
  describe("and the list doesn't exist or is not owned by the user", () => {
    let error: Error

    beforeEach(() => {
      error = new ListNotFoundError(listId)
      getListMock.mockRejectedValueOnce(error)
    })

    it('should reject with a list not found error', () => {
      return expect(accessComponent.createAccess(listId, permission, grantee, listOwner)).rejects.toEqual(error)
    })
  })

  describe('and the list exists and is owner by the user', () => {
    beforeEach(() => {
      getListMock.mockResolvedValueOnce(undefined)
    })

    describe('and the access already exists', () => {
      let error: Error

      beforeEach(() => {
        error = new DuplicatedAccessError(listId, permission, grantee)
        queryMock.mockRejectedValueOnce({ constraint: 'list_id_permissions_grantee_primary_key' })
      })

      it('should reject with a duplicated access error', () => {
        return expect(accessComponent.createAccess(listId, permission, grantee, listOwner)).rejects.toEqual(error)
      })
    })

    describe('and the access does not exist', () => {
      let result: unknown

      beforeEach(async () => {
        queryMock.mockResolvedValueOnce(undefined)
        result = await accessComponent.createAccess(listId, permission, grantee, listOwner)
      })

      it('should resolve to be undefined', () => {
        expect(result).toBeUndefined()
      })

      it('should insert the new access using the given parameters', async () => {
        expect(queryMock).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('INSERT INTO favorites.acl (list_id, permission, grantee) VALUES'),
            values: expect.arrayContaining([listId, permission, grantee])
          })
        )
      })
    })
  })
})
