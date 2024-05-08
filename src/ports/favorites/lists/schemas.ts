import { JSONSchema } from '@dcl/schemas'
import { AddItemToListBody, AddListRequestBody, UpdateListRequestBody } from './types'

export const AddPickInListSchema: JSONSchema<AddItemToListBody> = {
  type: 'object',
  properties: {
    itemId: {
      type: 'string',
      description: 'The item id to be added to the list',
      nullable: false,
      minLength: 1
    }
  },
  required: ['itemId']
}

export const ListCreationSchema: JSONSchema<AddListRequestBody> = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      maxLength: 32,
      description: 'The name of the list',
      minLength: 1
    },
    description: {
      type: 'string',
      maxLength: 100,
      nullable: true,
      default: null,
      description: 'A description of the list'
    },
    private: {
      type: 'boolean',
      description: 'Whether the list is private or not',
      nullable: false
    }
  },
  required: ['name', 'private']
}

export const ListUpdateSchema: JSONSchema<UpdateListRequestBody> = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      maxLength: 32,
      description: 'The name of the list',
      nullable: true
    },
    description: {
      type: 'string',
      maxLength: 100,
      nullable: true,
      default: null,
      description: 'A description of the list'
    },
    private: {
      type: 'boolean',
      description: 'Whether the list is private or not',
      nullable: true
    }
  },
  anyOf: [
    {
      required: ['name']
    },
    {
      required: ['private']
    },
    {
      required: ['description']
    }
  ]
}
