import { Permission } from '../../src/ports/favorites/access'
import { AccessNotFoundError, DuplicatedAccessError } from '../../src/ports/favorites/access/errors'
import { validateAccessExists, validateDuplicatedAccess } from '../../src/ports/favorites/access/utils'

const listId = 'list-id'
const permission = Permission.VIEW
const grantee = '*'

describe('when validating if an access exists', () => {
  describe('and the query returns no results', () => {
    it('should throw a AccessNotFound error', () => {
      expect(() => validateAccessExists(listId, permission, grantee, { rowCount: 0 })).toThrowError(
        new AccessNotFoundError(listId, permission, grantee)
      )
    })
  })

  describe('and the query returns something', () => {
    it('should do nothing', () => {
      expect(() => validateAccessExists(listId, permission, grantee, { rowCount: 5 })).not.toThrowError(
        new AccessNotFoundError(listId, permission, grantee)
      )
    })
  })
})

describe('when validating if an access is being duplicated', () => {
  describe('and the error has the constraint of a duplicated primary key', () => {
    it('should throw a DuplicatedAccess error', () => {
      expect(() =>
        validateDuplicatedAccess(listId, permission, grantee, { constraint: 'list_id_permissions_grantee_primary_key' })
      ).toThrowError(new DuplicatedAccessError(listId, permission, grantee))
    })
  })

  describe('and the error does not have has the constraint of a duplicated primary key', () => {
    it('should not throw the error', () => {
      expect(() => validateDuplicatedAccess(listId, permission, grantee, {})).not.toThrowError(
        new DuplicatedAccessError(listId, permission, grantee)
      )
    })
  })
})
