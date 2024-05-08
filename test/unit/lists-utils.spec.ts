import { DuplicatedListError, ListNotFoundError } from '../../src/ports/favorites/lists/errors'
import { validateDuplicatedListName, validateListExists } from '../../src/ports/favorites/lists/utils'

describe('when validating if a list exists', () => {
  const listId = 'list-id'

  describe('and the query returns no results', () => {
    it('should throw a ListNotFound error', () => {
      expect(() => validateListExists(listId, { rowCount: 0 })).toThrowError(new ListNotFoundError(listId))
    })
  })

  describe('and the query returns some results', () => {
    it('should throw a ListNotFound error', () => {
      expect(() => validateListExists(listId, { rowCount: 5 })).not.toThrowError(new ListNotFoundError(listId))
    })
  })
})

describe('when validating if a list name is being duplicated', () => {
  const name = 'aName'

  describe('and the error has the constraint of a unique name', () => {
    it('should throw a DuplicatedListError error', () => {
      expect(() => validateDuplicatedListName(name, { constraint: 'name_user_address_unique' })).toThrowError(new DuplicatedListError(name))
    })
  })

  describe('and the error does not have has the constraint of a unique name', () => {
    it('should not throw the error', () => {
      expect(() => validateDuplicatedListName(name, {})).not.toThrowError(new DuplicatedListError(name))
    })
  })
})
