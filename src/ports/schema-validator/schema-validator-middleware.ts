import { randomUUID } from 'crypto'
import { IHttpServerComponent } from '@well-known-components/interfaces'
import { Schema } from 'ajv'
import { Context, StatusCode } from '../../types'
import { addSchema, validateSchema } from './schema-validator'
import { ISchemaValidatorComponent } from './types'

export function createSchemaValidatorComponent(): ISchemaValidatorComponent {
  function withSchemaValidatorMiddleware(schema: Schema): IHttpServerComponent.IRequestHandler<Context<string>> {
    const schemaId = randomUUID()
    addSchema(schema, schemaId)

    return async (context, next): Promise<IHttpServerComponent.IResponse> => {
      if (context.request.headers.get('Content-Type') !== 'application/json') {
        return {
          status: StatusCode.BAD_REQUEST,
          body: {
            ok: false,
            message: 'Content-Type must be application/json'
          }
        }
      }

      let data: unknown

      try {
        data = await context.request.clone().json()
      } catch (error) {
        return {
          status: StatusCode.BAD_REQUEST,
          body: {
            ok: false,
            message: (error as { message: string }).message
          }
        }
      }

      const validation = validateSchema(schemaId, data)

      if (!validation.valid) {
        return {
          status: StatusCode.BAD_REQUEST,
          body: {
            ok: false,
            message: 'Invalid JSON body',
            data: validation.errors
          }
        }
      }

      return next()
    }
  }

  return {
    withSchemaValidatorMiddleware
  }
}
