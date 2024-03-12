import * as authorizationMiddleware from 'decentraland-crypto-middleware'
import { createWertSignerHandler } from '../../src/controllers/handlers/wert-signer-handler'
import { Target } from '../../src/ports/wert-signer/types'
import { AppComponents, HandlerContextWithPath, StatusCode } from '../../src/types'

describe('when getting the wert singer handler', () => {
  const wertSignerMock = {
    signMessage: jest.fn()
  }
  let url: URL
  let components: Pick<AppComponents, 'wertSigner'>
  let request: HandlerContextWithPath<'wertSigner', '/v1/wert/sign'>['request']
  let params: HandlerContextWithPath<'wertSigner', '/v1/wert/sign'>['params']
  let verification: authorizationMiddleware.DecentralandSignatureData | undefined

  beforeEach(() => {
    components = {
      wertSigner: wertSignerMock
    }
  })

  describe('and the user address is missing in the verification but is sent in the request body', () => {
    beforeEach(() => {
      request = {
        json: jest.fn().mockResolvedValueOnce({
          address: 'userAddress'
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    })
    it('should return an unauthorized response', async () => {
      expect(
        createWertSignerHandler({
          url,
          components,
          verification,
          request,
          params
        })
      ).resolves.toEqual({
        status: StatusCode.UNAUTHORIZED,
        body: {
          ok: false,
          message: 'Unauthorized'
        }
      })
    })
  })

  describe('and the user address is present in the verification but is different from the one in the request body', () => {
    let address1: string
    let address2: string
    beforeEach(() => {
      address1 = 'address1'
      address2 = 'address2'
      request = {
        json: jest.fn().mockResolvedValueOnce({
          address: address1
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
      verification = {
        auth: address2,
        authMetadata: {}
      }
    })
    it('should return an unauthorized response', async () => {
      expect(
        createWertSignerHandler({
          url,
          components,
          verification,
          request,
          params
        })
      ).resolves.toEqual({
        status: StatusCode.UNAUTHORIZED,
        body: {
          ok: false,
          message: 'Unauthorized'
        }
      })
    })
  })
  describe('and the user address is present in the verification and is the same one from the request body', () => {
    let address1: string
    let signature: string
    let target: string | undefined
    beforeEach(() => {
      address1 = 'address1'
      signature = 'aSignature'
      target = undefined
      request = {
        json: jest.fn().mockResolvedValueOnce({
          address: address1,
          target
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
      verification = {
        auth: address1,
        authMetadata: {}
      }
      wertSignerMock.signMessage.mockReturnValueOnce(signature)
    })

    describe('and the target is not in the body', () => {
      it('should return the signed response', async () => {
        expect(
          createWertSignerHandler({
            url,
            components,
            verification,
            request,
            params
          })
        ).resolves.toEqual({
          status: StatusCode.OK,
          body: {
            ok: true,
            data: signature
          }
        })
      })
    })

    describe('and the target is default', () => {
      beforeEach(() => {
        target = Target.DEFAULT
        request = {
          json: jest.fn().mockResolvedValueOnce({
            address: address1,
            target
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any
      })

      it('should return the signed response', async () => {
        expect(
          createWertSignerHandler({
            url,
            components,
            verification,
            request,
            params
          })
        ).resolves.toEqual({
          status: StatusCode.OK,
          body: {
            ok: true,
            data: signature
          }
        })
      })
    })

    describe('and the target is publicationFees', () => {
      beforeEach(() => {
        target = Target.PUBLICATION_FEES
        request = {
          json: jest.fn().mockResolvedValueOnce({
            address: address1,
            target
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any
      })

      it('should return the signed response', async () => {
        expect(
          createWertSignerHandler({
            url,
            components,
            verification,
            request,
            params
          })
        ).resolves.toEqual({
          status: StatusCode.OK,
          body: {
            ok: true,
            data: signature
          }
        })
      })
    })

    describe('and the target is invalid', () => {
      beforeEach(() => {
        target = 'invalid'
        request = {
          json: jest.fn().mockResolvedValueOnce({
            address: address1,
            target
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any
      })

      it('should return an error with invalid target message', async () => {
        expect(
          createWertSignerHandler({
            url,
            components,
            verification,
            request,
            params
          })
        ).resolves.toEqual({
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
