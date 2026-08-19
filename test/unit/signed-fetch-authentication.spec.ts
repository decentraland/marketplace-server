import type { IFetchComponent } from '@dcl/core-commons'
import { AuthLinkType, Authenticator, type AuthChain } from '@dcl/crypto'
import { RequestError, verify } from '@dcl/crypto-middleware'
import { validateAuthMetadata, validateNotKernelSceneSigner } from '../../src/controllers/utils'
import { getAuthHeaders, getIdentity } from '../utils'

const METHOD = 'POST'
const PATH = '/v1/lists/74241416-2e5f-4d9a-9d1d-b57b6dbb9ac1/picks'
const METADATA = { signer: 'dcl:marketplace', intent: 'dcl:marketplace:add-pick' }

describe('SignedFetch authentication', () => {
  async function signedHeaders(path = PATH, metadata = METADATA) {
    const identity = await getIdentity()
    const headers = getAuthHeaders(METHOD, path, metadata, payload =>
      Authenticator.signPayload(
        {
          ephemeralIdentity: identity.ephemeralIdentity,
          expiration: new Date(),
          authChain: identity.authChain.authChain
        },
        payload
      )
    )

    return { headers, identity }
  }

  it('accepts a canonical personal-signature request for the API-prefixed path', async () => {
    const { headers, identity } = await signedHeaders()

    await expect(verify(METHOD, PATH, headers)).resolves.toEqual({
      auth: identity.realAccount.address.toLowerCase(),
      authMetadata: METADATA
    })
  })

  it('rejects a signature whose path omits the API-version prefix', async () => {
    const { headers } = await signedHeaders(PATH.replace('/v1', ''))

    await expect(verify(METHOD, PATH, headers)).rejects.toBeInstanceOf(RequestError)
  })

  it('rejects a legacy method:path signature', async () => {
    const identity = await getIdentity()
    const legacyChain = Authenticator.signPayload(
      {
        ephemeralIdentity: identity.ephemeralIdentity,
        expiration: new Date(),
        authChain: identity.authChain.authChain
      },
      `${METHOD.toLowerCase()}:${PATH.toLowerCase()}`
    )
    const headers = getAuthHeaders(METHOD, PATH, METADATA, () => legacyChain)

    await expect(verify(METHOD, PATH, headers)).rejects.toBeInstanceOf(RequestError)
  })

  /**
   * 6.0.0 removed the library's canonical-metadata check: metadata now reaches the service exactly
   * as it was signed, so `verify` on its own has no opinion about casing or padding. Refusing a
   * re-spelled value is the service's `metadataValidator` now — the same gate routes.ts installs,
   * built from the composable predicates in controllers/utils.ts.
   */
  it.each([
    ['mixed-case signer', { ...METADATA, signer: 'Dcl:Marketplace' }, 'Invalid auth signer'],
    ['whitespace-padded signer', { ...METADATA, signer: ' dcl:marketplace' }, 'Invalid auth signer'],
    ['mixed-case intent', { ...METADATA, intent: 'Dcl:Marketplace:Add-Pick' }, 'Invalid auth intent to perform this operation'],
    ['whitespace-padded intent', { ...METADATA, intent: 'dcl:marketplace:add-pick ' }, 'Invalid auth intent to perform this operation']
  ])('rejects a %s at the service metadata validator', async (_case, metadata, message) => {
    const { headers } = await signedHeaders(PATH, metadata)
    const metadataValidator = validateAuthMetadata(['dcl:marketplace'], 'dcl:marketplace:add-pick')

    await expect(verify(METHOD, PATH, headers, { metadataValidator })).rejects.toMatchObject({ statusCode: 400, message })
    // Nothing is wrong with the signature: the metadata bytes are signed verbatim, so the library
    // alone accepts the request. That is precisely why the gate has to do the rejecting.
    await expect(verify(METHOD, PATH, headers)).resolves.toMatchObject({ authMetadata: metadata })
  })

  it('rejects expired and malformed auth headers', async () => {
    const { headers } = await signedHeaders()
    headers['x-identity-timestamp'] = String(Date.now() - 10 * 60 * 1000)

    await expect(verify(METHOD, PATH, headers)).rejects.toMatchObject({ statusCode: 401 })
    await expect(verify(METHOD, PATH, { 'x-identity-auth-chain-0': '{' })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('accepts an EIP-1654 chain only when verify receives a valid Catalyst response', async () => {
    const ownerAddress = '0x0000000000000000000000000000000000000001'
    const authChain: AuthChain = [
      { type: AuthLinkType.SIGNER, payload: ownerAddress, signature: '' },
      { type: AuthLinkType.ECDSA_EIP_1654_EPHEMERAL, payload: '', signature: '' },
      { type: AuthLinkType.ECDSA_EIP_1654_SIGNED_ENTITY, payload: '', signature: '' }
    ]
    const headers = getAuthHeaders(METHOD, PATH, METADATA, () => authChain)
    const fetcher = {
      fetch: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ valid: true, ownerAddress })
      })
    }

    await expect(verify(METHOD, PATH, headers, { fetcher: fetcher as unknown as IFetchComponent })).resolves.toMatchObject({
      auth: ownerAddress
    })
    expect(fetcher.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/lambdas/crypto/validate-signature'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('keeps the canonical kernel-scene signer blocked by the service policy', () => {
    expect(() => validateNotKernelSceneSigner({ signer: 'decentraland-kernel-scene' })).toThrow('Invalid signer')
    expect(validateNotKernelSceneSigner({ signer: 'dcl:explorer' })).toBe(true)
  })
})
