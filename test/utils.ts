import { getIdentity, getSignedAuthHeaders, type Identity } from '@dcl/test-helpers'

export { getAuthHeaders, getIdentity } from '@dcl/test-helpers'
export type { Identity } from '@dcl/test-helpers'

export async function getSignedFetchRequest(
  method: string,
  path: string,
  customMetadata: { intent: string; signer: string } = { intent: 'test', signer: 'integration:test' }
): Promise<{ method: string; headers: any; identity: Identity }> {
  const identity = await getIdentity()
  return {
    identity,
    method: method,
    headers: {
      ...getSignedAuthHeaders(
        'POST',
        path,
        {
          origin: 'https://play.decentraland.org',
          intent: customMetadata.intent,
          signer: customMetadata.signer,
          isGuest: 'false'
        },
        identity
      )
    }
  }
}
