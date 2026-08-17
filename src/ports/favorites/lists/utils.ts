import { DEFAULT_LIST_ID } from '../../../migrations/favorites/1678303321034_default-list'
import { DuplicatedListError, ListNotFoundError } from './errors'

// Postgres stores the list id as a `uuid`, which it compares case-insensitively and also parses
// from spellings that carry no hyphens or are wrapped in braces. A plain string `===` against the
// canonical lowercase literal therefore misses those spellings while they still resolve to the same
// row, which is enough to slip past the default-list guard. Reduce any id to its bare lowercase hex
// digits before comparing so every textual form of the default list id is recognised.
const toHex = (id: string): string => id.toLowerCase().replace(/[^0-9a-f]/g, '')
const DEFAULT_LIST_ID_HEX = toHex(DEFAULT_LIST_ID)

export function isDefaultList(listId: string): boolean {
  return toHex(listId) === DEFAULT_LIST_ID_HEX
}

export function validateListExists(id: string, result: { rowCount: number | null }) {
  if (result.rowCount == null || result.rowCount === 0) {
    throw new ListNotFoundError(id)
  }
}

export function validateDuplicatedListName(name: string, error: unknown) {
  if (error && typeof error === 'object' && 'constraint' in error && error.constraint === 'name_user_address_unique') {
    throw new DuplicatedListError(name)
  }
}
