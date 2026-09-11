import { JSONSchema, Network } from '@dcl/schemas'
import { TradeCreationSchema } from '../trades/schemas'
import { CouponCreation, MAX_COUPON_COLLECTIONS } from './types'

const ADDRESS_PATTERN = '^0x[0-9a-fA-F]{40}$'

/**
 * The same `checks` a trade posts, so a client signs both with one code path, except that a coupon must
 * send `allowedRoot` and `externalChecks`. A trade may leave them out, but the coupon signature is built
 * over both, and a missing `allowedRoot` throws inside the EIP-712 encoding — which surfaces to the
 * creator as "invalid signature" and points at the wrong problem.
 */
const CouponChecksSchema = {
  ...TradeCreationSchema.properties.checks,
  required: [...TradeCreationSchema.properties.checks.required, 'allowedRoot', 'externalChecks']
}

export const CouponCreationSchema: JSONSchema<CouponCreation> = {
  type: 'object',
  properties: {
    signer: { type: 'string', pattern: ADDRESS_PATTERN },
    chainId: { type: 'number' },
    network: { type: 'string', enum: [Network.ETHEREUM, Network.MATIC] },
    checks: CouponChecksSchema,
    couponAddress: { type: 'string', pattern: ADDRESS_PATTERN },
    discountType: { type: 'integer', minimum: 1 },
    discount: { type: 'integer', minimum: 1 },
    collections: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_COUPON_COLLECTIONS,
      items: { type: 'string', pattern: ADDRESS_PATTERN }
    },
    signature: { type: 'string' }
  },
  required: ['signer', 'chainId', 'network', 'checks', 'couponAddress', 'discountType', 'discount', 'collections', 'signature'],
  additionalProperties: false
}
