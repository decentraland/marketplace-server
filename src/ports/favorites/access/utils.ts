import { AccessNotFoundError, DuplicatedAccessError } from './errors'
import { Permission } from './types'

export function validateAccessExists(listId: string, permission: Permission, grantee: string, result: { rowCount: number }) {
  if (!result.rowCount) {
    throw new AccessNotFoundError(listId, permission, grantee)
  }
}

export function validateDuplicatedAccess(listId: string, permission: Permission, grantee: string, error: unknown) {
  if (error && typeof error === 'object' && 'constraint' in error && error.constraint === 'list_id_permissions_grantee_primary_key') {
    throw new DuplicatedAccessError(listId, permission, grantee)
  }
}
