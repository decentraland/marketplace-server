import * as authorizationMiddleware from 'decentraland-crypto-middleware'
import { createWertSignerAndSessionCreatorHandler } from '../../src/controllers/handlers/wert-signer-and-session-creator-handler'
import { WertSession } from '../../src/ports/wert/api/types'
import { WertMessage } from '../../src/ports/wert/signer/types'
import { Target } from '../../src/ports/wert/types'
import { AppComponents, HandlerContextWithPath, StatusCode } from '../../src/types'

describe('when getting the wert signer and session creator handler', () => {
  const wertSignerMock = {
    signMessage: jest.fn()
  }
  const wertApiMock = {
    createSession: jest.fn()
  }

  let url: URL
  let components: Pick<AppComponents, 'wertSigner' | 'wertApi'>
  let request: HandlerContextWithPath<'wertSigner' | 'wertApi', '/v1/wert/sign'>['request']
  let params: HandlerContextWithPath<'wertSigner' | 'wertApi', '/v1/wert/sign'>['params']
  let verification: authorizationMiddleware.DecentralandSignatureData | undefined

  beforeEach(() => {
    components = {
      wertSigner: wertSignerMock,
      wertApi: wertApiMock
    }
    wertSignerMock.signMessage.mockReset()
    wertApiMock.createSession.mockReset()
  })

  describe('when verification is missing', () => {
    beforeEach(() => {
      request = {
        json: jest.fn().mockResolvedValueOnce({
          message: { address: 'userAddress' } as WertMessage,
          session: { wallet_address: 'userAddress' } as WertSession
        })
      } as any
    })

    it('should return an unauthorized response', async () => {
      const response = await createWertSignerAndSessionCreatorHandler({
        url,
        components,
        verification: undefined,
        request,
        params
      })

      expect(response).toEqual({
        status: StatusCode.UNAUTHORIZED,
        body: {
          ok: false,
          message: 'Unauthorized'
        }
      })
    })
  })

  describe('when addresses do not match', () => {
    const testCases = [
      {
        scenario: 'message address differs from verification',
        message: { address: 'differentAddress' } as WertMessage,
        session: { wallet_address: 'userAddress' } as WertSession,
        verificationAddress: 'userAddress'
      },
      {
        scenario: 'session address differs from verification',
        message: { address: 'userAddress' } as WertMessage,
        session: { wallet_address: 'differentAddress' } as WertSession,
        verificationAddress: 'userAddress'
      },
      {
        scenario: 'both addresses differ from verification',
        message: { address: 'differentAddress1' } as WertMessage,
        session: { wallet_address: 'differentAddress2' } as WertSession,
        verificationAddress: 'userAddress'
      }
    ]

    describe.each(testCases)('and $scenario', ({ message, session, verificationAddress }) => {
      beforeEach(() => {
        request = {
          json: jest.fn().mockResolvedValueOnce({ message, session })
        } as any
        verification = {
          auth: verificationAddress,
          authMetadata: {}
        }
      })

      it('should return an unauthorized response', async () => {
        const response = await createWertSignerAndSessionCreatorHandler({
          url,
          components,
          verification,
          request,
          params
        })

        expect(response).toEqual({
          status: StatusCode.UNAUTHORIZED,
          body: {
            ok: false,
            message: 'Unauthorized'
          }
        })
      })
    })
  })

  describe('when addresses match and request is valid', () => {
    let signature: string
    let sessionId: string
    let address: string
    let message: WertMessage
    let session: WertSession

    beforeEach(() => {
      signature = 'aSignature'
      sessionId = 'aSessionId'
      address = 'userAddress'
      message = { address } as WertMessage
      session = { wallet_address: address } as WertSession
      request = {
        json: jest.fn().mockResolvedValueOnce({
          message,
          session
        })
      } as any
      verification = {
        auth: address,
        authMetadata: {}
      }
    })

    describe('and signer fails', () => {
      beforeEach(() => {
        wertSignerMock.signMessage.mockRejectedValueOnce(new Error('Signing failed'))
      })

      it('should propagate the error', async () => {
        await expect(
          createWertSignerAndSessionCreatorHandler({
            url,
            components,
            verification,
            request,
            params
          })
        ).rejects.toThrow('Signing failed')
      })
    })

    describe('and session creation fails', () => {
      beforeEach(() => {
        wertApiMock.createSession.mockRejectedValueOnce(new Error('Session creation failed'))
      })

      it('should propagate the error', async () => {
        await expect(
          createWertSignerAndSessionCreatorHandler({
            url,
            components,
            verification,
            request,
            params
          })
        ).rejects.toThrow('Session creation failed')
      })
    })

    describe('and signer and session creation succeed', () => {
      beforeEach(() => {
        wertSignerMock.signMessage.mockResolvedValueOnce(signature)
        wertApiMock.createSession.mockResolvedValueOnce({ sessionId })
      })

      it('should return both signature and session id', async () => {
        const response = await createWertSignerAndSessionCreatorHandler({
          url,
          components,
          verification,
          request,
          params
        })

        expect(response).toEqual({
          status: StatusCode.OK,
          body: {
            ok: true,
            data: {
              signature,
              sessionId
            }
          }
        })
        expect(wertSignerMock.signMessage).toHaveBeenCalledWith(message, undefined)
        expect(wertApiMock.createSession).toHaveBeenCalledWith(session, undefined)
      })

      describe('with different targets', () => {
        const targets = [
          { target: Target.DEFAULT, description: 'default target' },
          { target: Target.PUBLICATION_FEES, description: 'publication fees target' }
        ]

        describe.each(targets)('and $description', ({ target }) => {
          beforeEach(() => {
            request = {
              json: jest.fn().mockResolvedValueOnce({
                message,
                session,
                target
              })
            } as any
          })

          it('should return both signature and session id', async () => {
            const response = await createWertSignerAndSessionCreatorHandler({
              url,
              components,
              verification,
              request,
              params
            })

            expect(response).toEqual({
              status: StatusCode.OK,
              body: {
                ok: true,
                data: {
                  signature,
                  sessionId
                }
              }
            })
            expect(wertSignerMock.signMessage).toHaveBeenCalledWith(message, target)
            expect(wertApiMock.createSession).toHaveBeenCalledWith(session, target)
          })
        })
      })

      describe('with invalid target', () => {
        beforeEach(() => {
          request = {
            json: jest.fn().mockResolvedValueOnce({
              message,
              session,
              target: 'invalid'
            })
          } as any
        })

        it('should return an error with invalid target message', async () => {
          const response = await createWertSignerAndSessionCreatorHandler({
            url,
            components,
            verification,
            request,
            params
          })

          expect(response).toEqual({
            status: StatusCode.BAD_REQUEST,
            body: {
              ok: false,
              message: 'Invalid target'
            }
          })
        })
      })
    })
  })
})
