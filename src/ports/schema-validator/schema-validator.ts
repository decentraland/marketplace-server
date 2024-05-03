import Ajv, { Schema } from 'ajv'
import addFormats from 'ajv-formats'
import { Validation } from './types'

const ajv = new Ajv({ removeAdditional: true })
addFormats(ajv)

export function addSchema(schema: Schema, key: string): void {
  ajv.addSchema(schema, key)
}

export function validateSchema(schemaKey: string, data: unknown): Validation {
  const validate = ajv.getSchema<unknown>(schemaKey)

  if (!validate) {
    throw new Error(`No schema was found with the key ${schemaKey}`)
  }

  const valid = validate(data) as boolean

  return {
    valid,
    errors: validate.errors ?? null
  }
}
