import Ajv from 'ajv'
import { ChainId, Network } from '@dcl/schemas'
import { DISCOUNT_TYPE_RATE } from '../../src/logic/coupons/signature'
import { CouponCreationSchema } from '../../src/ports/coupons/schemas'

const validate = new Ajv({ allErrors: true }).compile(CouponCreationSchema as object)

const COLLECTION = '0x4c09495cd2d4e3d3fa2808eb655d013de426157b'

function body(checks: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  return {
    signer: COLLECTION,
    chainId: ChainId.MATIC_MAINNET,
    network: Network.MATIC,
    checks: {
      uses: 10,
      expiration: Date.now() + 1000,
      effective: Date.now(),
      salt: '0x' + '11'.repeat(32),
      contractSignatureIndex: 0,
      signerSignatureIndex: 0,
      allowedRoot: '0x',
      externalChecks: [],
      ...checks
    },
    couponAddress: COLLECTION,
    discountType: DISCOUNT_TYPE_RATE,
    discount: 300_000,
    collections: [COLLECTION],
    signature: '0x' + 'ab'.repeat(65),
    ...overrides
  }
}

/**
 * The schema is the only thing standing between a malformed body and the EIP-712 encoder, which throws on
 * anything that is not BytesLike. What it lets through has to be paddable to bytes32.
 */
describe('when validating what a creator posts as a coupon', () => {
  describe('and the body is well formed', () => {
    it('should accept it', () => {
      expect(validate(body())).toBe(true)
    })
  })

  describe.each(['salt', 'allowedRoot'])('and %s is an empty string', field => {
    it('should refuse it, rather than let the signature encoder throw on it later', () => {
      expect(validate(body({ [field]: '' }))).toBe(false)
    })
  })

  describe.each(['salt', 'allowedRoot'])('and %s is not hex', field => {
    it('should refuse it', () => {
      expect(validate(body({ [field]: '0xzz' }))).toBe(false)
      // Odd-length hex is not a whole number of bytes, and pads no better than a letter does.
      expect(validate(body({ [field]: '0x1' }))).toBe(false)
    })
  })

  describe('and allowedRoot is the empty root', () => {
    it('should accept it, because that is how "anyone may use this" is spelled', () => {
      expect(validate(body({ allowedRoot: '0x' }))).toBe(true)
    })
  })

  describe('and the same collection is listed twice', () => {
    it('should refuse it at the schema rather than silently de-duplicate it', () => {
      expect(validate(body({}, { collections: [COLLECTION, COLLECTION] }))).toBe(false)
    })
  })

  describe('and the signature is not 65 bytes of hex', () => {
    it('should refuse it before the body is taken any further', () => {
      expect(validate(body({}, { signature: '0x' + 'ab'.repeat(64) }))).toBe(false)
      expect(validate(body({}, { signature: 'not-a-signature' }))).toBe(false)
    })
  })
})
