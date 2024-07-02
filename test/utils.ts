import { Authenticator } from '@dcl/crypto'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'
import { AuthChain } from '@dcl/schemas'
import { AUTH_CHAIN_HEADER_PREFIX, AUTH_METADATA_HEADER, AUTH_TIMESTAMP_HEADER } from 'decentraland-crypto-middleware/lib/types'

export async function getIdentity() {
  const ephemeralIdentity = createUnsafeIdentity()
  const realAccount = createUnsafeIdentity()

  const authChain = await Authenticator.initializeAuthChain(realAccount.address, ephemeralIdentity, 10, async message => {
    return Authenticator.createSignature(realAccount, message)
  })

  return { authChain, realAccount, ephemeralIdentity }
}

export function getAuthHeaders(method: string, path: string, metadata: Record<string, any>, chainProvider: (payload: string) => AuthChain) {
  const headers: Record<string, string> = {}
  const timestamp = Date.now()
  const metadataJSON = JSON.stringify(metadata)
  const payloadParts = [method.toLowerCase(), path.toLowerCase(), timestamp.toString(), metadataJSON]
  const payloadToSign = payloadParts.join(':').toLowerCase()

  const chain = chainProvider(payloadToSign)

  chain.forEach((link, index) => {
    headers[`${AUTH_CHAIN_HEADER_PREFIX}${index}`] = JSON.stringify(link)
  })

  headers[AUTH_TIMESTAMP_HEADER] = timestamp.toString()
  headers[AUTH_METADATA_HEADER] = metadataJSON

  return headers
}

export async function getSignedFetchRequest(
  method: string,
  path: string,
  customMetadata: { intent: string; signer: string } = { intent: 'test', signer: 'integration:test' }
): Promise<{ method: string; headers: any; identity: Awaited<ReturnType<typeof getIdentity>> }> {
  const identity = await getIdentity()
  return {
    identity,
    method: method,
    headers: {
      ...getAuthHeaders(
        'POST',
        path,
        {
          origin: 'https://play.decentraland.org',
          intent: customMetadata.intent,
          signer: customMetadata.signer,
          isGuest: 'false'
        },
        payload => {
          return Authenticator.signPayload(
            {
              ephemeralIdentity: identity.ephemeralIdentity,
              expiration: new Date(),
              authChain: identity.authChain.authChain
            },
            payload
          )
        }
      )
    }
  }
}
