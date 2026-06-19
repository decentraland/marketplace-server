import { JSONSchema } from '@dcl/schemas'
import { WertMessage } from './signer/types'
import { Target } from './types'

/**
 * Validation shape for the `POST /v1/wert/sign` body. Only the fields the handler depends on are
 * declared; the Wert session accepts many optional fields, so additional properties are allowed.
 */
type WertSignBody = {
  message: WertMessage
  session: { flow_type: string }
  target?: Target
}

export const WertSignBodySchema: JSONSchema<WertSignBody> = {
  type: 'object',
  properties: {
    message: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        commodity: { type: 'string' },
        commodity_amount: { type: 'number' },
        network: { type: 'string' },
        sc_address: { type: 'string' },
        sc_input_data: { type: 'string' }
      },
      required: ['address', 'commodity', 'commodity_amount', 'network', 'sc_address', 'sc_input_data'],
      additionalProperties: false
    },
    session: {
      type: 'object',
      properties: {
        flow_type: { type: 'string', enum: ['simple', 'simple_full_restrict'] }
      },
      required: ['flow_type'],
      additionalProperties: true
    },
    target: { type: 'string', enum: [Target.DEFAULT, Target.PUBLICATION_FEES], nullable: true }
  },
  required: ['message', 'session'],
  additionalProperties: false
}
