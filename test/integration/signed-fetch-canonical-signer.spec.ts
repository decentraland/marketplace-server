import { Authenticator } from '@dcl/crypto'
import { test } from '../components'
import { getAuthHeaders, getIdentity } from '../utils'

const LIST_ID = '74241416-2e5f-4d9a-9d1d-b57b6dbb9ac1'
const ITEM_ID = '0x08de0de733cc11081d43569b809c00e6ddf314fb-0'
const PATH = `/v1/lists/${LIST_ID}/picks/${ITEM_ID}`

/**
 * `DELETE /v1/lists/:id/picks/:itemId` is `optional: false` and gated by validateNotKernelSceneSigner
 * with no schema validator in front of the handler, so the middleware's verdict is the only thing
 * that decides the status here.
 */
test('signed-fetch canonical signer guard', function ({ components }) {
  /**
   * `getAuthHeaders` signs the metadata bytes verbatim, so a mixed-case `signer` is covered by the
   * signature and the request is genuinely authentic — it simply reads differently to the
   * case-sensitive comparison the service authorizes on. That desync is the attack, and since
   * 6.0.0 no longer canonicalizes metadata the gate itself has to refuse it. Nothing here weakens
   * the signature.
   */
  async function deletePick(metadata: Record<string, unknown>) {
    const { localFetch } = components
    const identity = await getIdentity()

    return localFetch.fetch(PATH, {
      method: 'DELETE',
      headers: getAuthHeaders('DELETE', PATH, metadata, payload =>
        Authenticator.signPayload(
          {
            ephemeralIdentity: identity.ephemeralIdentity,
            expiration: new Date(),
            authChain: identity.authChain.authChain
          },
          payload
        )
      )
    })
  }

  describe('when the canonical kernel-scene signer was signed but a mixed-case spelling is delivered', () => {
    it('should respond with 400 rather than let it past the scene gate', async () => {
      const response = await deletePick({
        origin: 'https://play.decentraland.org',
        signer: 'Decentraland-Kernel-Scene',
        isGuest: 'false'
      })
      const body = await response.json()

      // `rejectIfSigner` refuses a non-canonical `signer` instead of comparing it, so a scene
      // request cannot be authenticated as a directly user-signed one. With a bare
      // `=== 'decentraland-kernel-scene'` check the mixed-case spelling would pass the gate and the
      // handler would run — the library stopped canonicalizing metadata in 6.0.0, so this is the
      // only layer left that can say no.
      expect(response.status).toBe(400)
      expect(body).toEqual({ ok: false, message: 'Invalid signer' })
    })
  })

  describe('when the kernel-scene signer is delivered exactly as signed', () => {
    it('should respond with 400 from the scene gate', async () => {
      const response = await deletePick({
        origin: 'https://play.decentraland.org',
        signer: 'decentraland-kernel-scene',
        isGuest: 'false'
      })

      // validateNotKernelSceneSigner throws RequestError('Invalid signer', 400); the status comes
      // from the thrown error's statusCode, so a plain Error here would silently become a 500.
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ ok: false, message: 'Invalid signer' })
    })
  })

  describe('when the request carries no signer at all', () => {
    it('should authenticate normally and reach the handler', async () => {
      const response = await deletePick({
        origin: 'https://play.decentraland.org',
        intent: 'dcl:marketplace:remove-pick',
        isGuest: 'false'
      })

      // Reaching the handler is the point: it answers about the missing list rather than refusing
      // the signature, which proves the guard leaves ordinary user traffic alone.
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({
        ok: false,
        message: 'The pick does not exist or is not accessible by this user.',
        data: { listId: LIST_ID, itemId: ITEM_ID }
      })
    })
  })
})
