import { AppComponents } from '../../../types'
import { deleteAccessQuery, insertAccessQuery } from './queries'
import { IAccessComponent, Permission } from './types'
import { validateAccessExists, validateDuplicatedAccess } from './utils'

export function createAccessComponent(components: Pick<AppComponents, 'favoritesDatabase' | 'logs' | 'lists'>): IAccessComponent {
  const { favoritesDatabase: pg, logs, lists } = components

  const logger = logs.getLogger('Access component')

  async function deleteAccess(listId: string, permission: Permission, grantee: string, listOwner: string): Promise<void> {
    const result = await pg.query(deleteAccessQuery(listId, permission, grantee, listOwner))

    validateAccessExists(listId, permission, grantee, result)

    logger.info(`Deleted access ${permission} for ${grantee} of the list ${listId}`)
  }

  async function createAccess(listId: string, permission: Permission, grantee: string, listOwner: string): Promise<void> {
    try {
      await lists.getList(listId, { userAddress: listOwner, considerDefaultList: false })
      await pg.query(insertAccessQuery(listId, permission, grantee))
    } catch (error) {
      validateDuplicatedAccess(listId, permission, grantee, error)

      throw error
    }
  }

  return {
    createAccess,
    deleteAccess
  }
}
