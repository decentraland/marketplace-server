import { DEFAULT_LIST_ID } from '../../src/migrations/favorites/1678303321034_default-list'
import { DuplicatedListError, ListNotFoundError } from '../../src/ports/favorites/lists/errors'
import { isDefaultList, validateDuplicatedListName, validateListExists } from '../../src/ports/favorites/lists/utils'

describe('when validating if a list exists', () => {
  const listId = 'list-id'

  describe('and the query returns no results', () => {
    it('should throw a ListNotFound error', () => {
      expect(() => validateListExists(listId, { rowCount: 0 })).toThrowError(new ListNotFoundError(listId))
    })
  })

  describe('and the query does not report a row count', () => {
    it('should throw a ListNotFound error', () => {
      expect(() => validateListExists(listId, { rowCount: null })).toThrowError(new ListNotFoundError(listId))
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

describe('when checking if an id points to the default list', () => {
  describe('and the id is the canonical default list id', () => {
    it('should return true', () => {
      expect(isDefaultList(DEFAULT_LIST_ID)).toBe(true)
    })
  })

  describe('and the id is the default list id spelled in uppercase', () => {
    it('should return true because Postgres resolves it to the same row', () => {
      expect(isDefaultList(DEFAULT_LIST_ID.toUpperCase())).toBe(true)
    })
  })

  describe('and the id is the default list id without hyphens', () => {
    it('should return true because Postgres resolves it to the same row', () => {
      expect(isDefaultList(DEFAULT_LIST_ID.replace(/-/g, ''))).toBe(true)
    })
  })

  describe('and the id is the default list id wrapped in braces', () => {
    it('should return true because Postgres resolves it to the same row', () => {
      expect(isDefaultList(`{${DEFAULT_LIST_ID}}`)).toBe(true)
    })
  })

  describe('and the id is the default list id in uppercase and without hyphens', () => {
    it('should return true because Postgres resolves it to the same row', () => {
      expect(isDefaultList(DEFAULT_LIST_ID.replace(/-/g, '').toUpperCase())).toBe(true)
    })
  })

  describe('and the id belongs to another list', () => {
    it('should return false', () => {
      expect(isDefaultList('11111111-1111-1111-1111-111111111111')).toBe(false)
    })
  })
})
