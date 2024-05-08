import { JSONSchema } from '@dcl/schemas'
import { PickUnpickInBulkBody } from './types'

export const PickUnpickInBulkSchema: JSONSchema<PickUnpickInBulkBody> = {
  type: 'object',
  properties: {
    pickedFor: {
      type: 'array',
      items: {
        type: 'string'
      },
      nullable: true,
      minItems: 1
    },
    unpickedFrom: {
      type: 'array',
      items: {
        type: 'string'
      },
      nullable: true,
      minItems: 1
    }
  },
  anyOf: [
    {
      required: ['pickedFor']
    },
    {
      required: ['unpickedFrom']
    }
  ]
}
