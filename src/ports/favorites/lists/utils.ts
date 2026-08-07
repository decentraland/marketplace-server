import { DuplicatedListError, ListNotFoundError } from './errors'

export function validateListExists(id: string, result: { rowCount: number | null }) {
  if (!result.rowCount) {
    throw new ListNotFoundError(id)
  }
}

export function validateDuplicatedListName(name: string, error: unknown) {
  if (error && typeof error === 'object' && 'constraint' in error && error.constraint === 'name_user_address_unique') {
    throw new DuplicatedListError(name)
  }
}
