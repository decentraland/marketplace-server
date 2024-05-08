import { JSONSchema } from '@dcl/schemas'
import { AccessBody } from '../../../controllers/handlers/favorites/types'
import { Permission } from './types'

export const AccessBodySchema: JSONSchema<AccessBody> = {
  type: 'object',
  properties: {
    permission: {
      type: 'string',
      description: `The permission to be granted ${Object.values(Permission)}`,
      enum: Object.values(Permission)
    },
    grantee: {
      type: 'string',
      description: 'The ethereum address of the grantee or a "*" to grant access to everyone',
      nullable: false,
      minLength: 1,
      maxLength: 42,
      pattern: '^0x[a-fA-F0-9]{40}$|\\*' // Matches ethereum addresses or a "*"
    }
  },
  required: ['permission', 'grantee']
}
