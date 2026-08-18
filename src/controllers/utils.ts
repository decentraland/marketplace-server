import { RequestError, rejectIfSigner, requireCanonicalField, requireSigner } from '@dcl/crypto-middleware'

/**
 * `@dcl/crypto-middleware` 6.0.0 stopped canonicalizing metadata: it now reaches the validator
 * exactly as the client signed it, so a plain `===` on `signer` or `intent` reads a re-spelled
 * value as something the request is not. The predicates below refuse a non-canonical value instead
 * of folding it, so the comparison that follows is meaningful. Nothing here rewrites what arrived.
 */
const isNotKernelSceneSigner = rejectIfSigner('decentraland-kernel-scene')

export function validateNotKernelSceneSigner(metadata: Record<string, any> | undefined) {
  if (metadata && !isNotKernelSceneSigner(metadata)) {
    throw new RequestError('Invalid signer', 400)
  }
  return true
}

export function validateAuthMetadata(signer: string | string[], intent: string | undefined) {
  // Built once, outside the returned validator: both helpers throw at construction on a
  // non-canonical value, so a bad route definition fails at startup rather than per request.
  const isAllowedSigner = requireSigner(...(Array.isArray(signer) ? signer : [signer]))
  const isAllowedIntent = intent ? requireCanonicalField('intent', intent) : undefined

  return (metadata: Record<string, any> | undefined) => {
    if (!metadata || !isAllowedSigner(metadata)) {
      throw new RequestError('Invalid auth signer', 400)
    }

    if (isAllowedIntent && !isAllowedIntent(metadata)) {
      throw new RequestError('Invalid auth intent to perform this operation', 400)
    }

    return true
  }
}
