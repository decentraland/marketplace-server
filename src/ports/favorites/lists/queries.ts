import SQL from 'sql-template-strings'
import { DEFAULT_LIST_ID, DEFAULT_LIST_USER_ADDRESS } from '../../../migrations/favorites/1678303321034_default-list'
import { Permission } from '../access'
import { GRANTED_TO_ALL } from './constants'
import { GetListOptions } from './types'

export function getListQuery(listId: string, { requiredPermission, considerDefaultList = true, userAddress }: GetListOptions) {
  const query = SQL`SELECT favorites.lists.id, favorites.lists.name, favorites.lists.description, favorites.lists.user_address, favorites.lists.created_at`

  query.append(listId === DEFAULT_LIST_ID ? SQL`, MAX(favorites.picks.created_at) as updated_at` : SQL`, favorites.lists.updated_at`)

  query.append(
    SQL`, favorites.acl.permission AS permission, COUNT(favorites.picks.item_id) AS items_count, COUNT(favorites.acl.permission) = 0 AS is_private,
    (ARRAY_REMOVE(ARRAY_AGG(favorites.picks.item_id ORDER BY favorites.picks.created_at), NULL))[:4] AS preview_of_item_ids
    FROM favorites.lists
    LEFT JOIN favorites.picks ON favorites.lists.id = favorites.picks.list_id AND (favorites.picks.user_address = ${userAddress} OR favorites.picks.user_address = favorites.lists.user_address)
    LEFT JOIN favorites.acl ON favorites.lists.id = favorites.acl.list_id`
  )

  query.append(SQL` WHERE favorites.lists.id = ${listId} AND (favorites.lists.user_address = ${userAddress}`)
  if (considerDefaultList) {
    query.append(SQL` OR favorites.lists.user_address = ${DEFAULT_LIST_USER_ADDRESS}`)
  }

  if (requiredPermission) {
    const requiredPermissions = requiredPermission === Permission.VIEW ? [Permission.VIEW, Permission.EDIT] : [requiredPermission]
    query.append(
      SQL` OR ((favorites.acl.grantee = ${userAddress} OR favorites.acl.grantee = ${GRANTED_TO_ALL}) AND favorites.acl.permission = ANY(${requiredPermissions}))`
    )
  }
  query.append(')')

  query.append(SQL` GROUP BY favorites.lists.id, favorites.acl.permission`)
  query.append(SQL` ORDER BY favorites.acl.permission ASC LIMIT 1`)

  return query
}
