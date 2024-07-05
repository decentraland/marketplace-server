import RequestError from 'decentraland-crypto-middleware/lib/errors'

export function validateNotKernelSceneSigner(metadata: Record<string, any> | undefined) {
  if (metadata && metadata.signer === 'decentraland-kernel-scene') {
    throw new RequestError('Invalid signer', 400)
  }
  return true
}

export function validateAuthMetadata(signer: string | string[], intent: string | undefined) {
  return (metadata: Record<string, any> | undefined) => {
    if (
      !metadata ||
      !metadata.signer ||
      (Array.isArray(signer) && !signer.includes(metadata.signer)) ||
      (typeof signer === 'string' && metadata.signer !== signer)
    ) {
      throw new RequestError('Invalid auth signer', 400)
    }

    if (intent && metadata.intent !== intent) {
      throw new RequestError('Invalid auth intent to perform this operation', 400)
    }

    return true
  }
}
