import { Permission } from '../../../ports/favorites/access'
export type AccessBody = { permission: Permission; grantee: string }
