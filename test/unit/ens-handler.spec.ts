import { createENSImageGeratorHandler } from '../../src/controllers/handlers/ens'
import { AppComponents, HandlerContextWithPath, StatusCode } from '../../src/types'

describe('when getting the create ENS image handler ', () => {
  const ensImageGeneratorMock = {
    generateImage: jest.fn()
  }
  let url: URL
  let components: Pick<AppComponents, 'ens'>
  let request: HandlerContextWithPath<'ens', '/v1/ens/generate'>['request']

  beforeEach(() => {
    request = {} as HandlerContextWithPath<'ens', '/v1/ens/generate'>['request']
    components = {
      ens: ensImageGeneratorMock
    }
  })

  describe('and some parameters are missing', () => {
    beforeEach(() => {
      url = {
        searchParams: new URLSearchParams()
      } as URL
    })
    describe('and the width is missing', () => {
      beforeEach(() => {
        url = {
          searchParams: new URLSearchParams('ens=ensName&height=100')
        } as URL
      })
      it('should return a bad request response', async () => {
        expect(
          createENSImageGeratorHandler({
            url,
            components,
            request
          })
        ).resolves.toEqual({
          status: StatusCode.BAD_REQUEST,
          body: {
            ok: false,
            message: 'Bad Request'
          }
        })
      })
    })
    describe('and the height is missing', () => {
      beforeEach(() => {
        url = {
          searchParams: new URLSearchParams('ens=ensName&width=100')
        } as URL
      })
      it('should return a bad request response', async () => {
        expect(
          createENSImageGeratorHandler({
            url,
            components,
            request
          })
        ).resolves.toEqual({
          status: StatusCode.BAD_REQUEST,
          body: {
            ok: false,
            message: 'Bad Request'
          }
        })
      })
    })
    describe('and the name is missing', () => {
      beforeEach(() => {
        url = {
          searchParams: new URLSearchParams('wdith=width&width=100')
        } as URL
      })
      it('should return a bad request response', async () => {
        expect(
          createENSImageGeratorHandler({
            url,
            components,
            request
          })
        ).resolves.toEqual({
          status: StatusCode.BAD_REQUEST,
          body: {
            ok: false,
            message: 'Bad Request'
          }
        })
      })
    })
  })
  describe('and all the parameters are present', () => {
    beforeEach(() => {
      url = {
        searchParams: new URLSearchParams('ens=ensName&width=100&height=100')
      } as URL
    })
    it('should return the image', async () => {
      expect(
        createENSImageGeratorHandler({
          url,
          components,
          request
        })
      ).resolves.toEqual({
        status: StatusCode.OK,
        headers: {
          'content-type': 'image/png'
        },
        body: await ensImageGeneratorMock.generateImage('ensName', 100, 100)
      })
    })
  })
})
