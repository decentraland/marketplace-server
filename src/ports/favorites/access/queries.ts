import SQL from 'sql-template-strings'
import { Permission } from './types'

export const deleteAccessQuery = (listId: string, permission: Permission, grantee: string, listOwner: string) => SQL`
    DELETE FROM favorites.acl USING favorites.lists
    WHERE favorites.acl.list_id = favorites.lists.id
    AND favorites.acl.list_id = ${listId}
    AND favorites.lists.user_address = ${listOwner}
    AND favorites.acl.permission = ${permission}
    AND favorites.acl.grantee = ${grantee}`

export const insertAccessQuery = (listId: string, permission: Permission, grantee: string) =>
  SQL`INSERT INTO favorites.acl (list_id, permission, grantee) VALUES (${listId}, ${permission}, ${grantee}) ON CONFLICT (list_id, permission, grantee) DO NOTHING`
