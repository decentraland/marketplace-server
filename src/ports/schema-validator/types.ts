import { IHttpServerComponent } from '@well-known-components/interfaces'
import { ErrorObject, Schema } from 'ajv'
import { Context } from '../../types'

export type Validation = {
  valid: boolean
  errors: null | ErrorObject[]
}

export type ISchemaValidatorComponent = {
  withSchemaValidatorMiddleware: (schema: Schema) => IHttpServerComponent.IRequestHandler<Context<string>>
}
