export enum Permission {
  VIEW = 'view',
  EDIT = 'edit'
}

export type DBAccess = {
  list_id: string
  permission: string
  grantee: string
}

export type IAccessComponent = {
  deleteAccess(listId: string, permission: Permission, grantee: string, listOwner: string): Promise<void>
  createAccess(listId: string, permission: Permission, grantee: string, listOwner: string): Promise<void>
}
