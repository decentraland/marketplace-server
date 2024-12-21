/* eslint-disable @typescript-eslint/unbound-method */
import { getNFTsHandler } from '../../src/controllers/handlers/nfts-handler'
import { getNFTParams } from '../../src/controllers/handlers/utils'
import { Params } from '../../src/logic/http/params'
import { InvalidSearchByTenantAndOwnerError, InvalidTokenIdError, MissingContractAddressParamError } from '../../src/ports/nfts/errors'
import { HandlerContextWithPath, StatusCode } from '../../src/types'

let context: Pick<HandlerContextWithPath<'nfts', '/v1/nfts'>, 'components' | 'url' | 'verification'>

describe('getNFTsHandler', () => {
  describe('when get nfts call is successful', () => {
    beforeEach(() => {
      context = {
        components: {
          nfts: {
            getNFTs: jest.fn().mockResolvedValue({ data: [], total: 0 })
          }
        },
        url: new URL('http://example.com/v1/nfts'),
        verification: {
          auth: 'TOKEN',
          authMetadata: {}
        }
      }
    })

    it('should return NFTs data and total count when successful', async () => {
      const result = await getNFTsHandler(context)

      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: [],
          total: 0
        }
      })
      expect(context.components.nfts.getNFTs).toHaveBeenCalledWith(getNFTParams(new Params(new URLSearchParams())), 'token')
    })
  })

  describe('when get nfts call throws InvalidSearchByTenantAndOwnerError', () => {
    beforeEach(() => {
      context = {
        components: {
          nfts: {
            getNFTs: jest.fn().mockRejectedValue(new InvalidSearchByTenantAndOwnerError())
          }
        },
        url: new URL('http://example.com/v1/nfts'),
        verification: {
          auth: 'TOKEN',
          authMetadata: {}
        }
      }
    })

    it('should return a bad request error', async () => {
      const result = await getNFTsHandler(context)
      expect(result).toEqual({
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: new InvalidSearchByTenantAndOwnerError().message
        }
      })
      expect(context.components.nfts.getNFTs).toHaveBeenCalledWith(getNFTParams(new Params(new URLSearchParams())), 'token')
    })
  })

  describe('when get nfts call throws InvalidTokenIdError', () => {
    beforeEach(() => {
      context = {
        components: {
          nfts: {
            getNFTs: jest.fn().mockRejectedValue(new InvalidTokenIdError())
          }
        },
        url: new URL('http://example.com/v1/nfts'),
        verification: {
          auth: 'TOKEN',
          authMetadata: {}
        }
      }
    })

    it('should return a bad request error when there is an invalid token ID', async () => {
      const result = await getNFTsHandler(context)

      expect(result).toEqual({
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: new InvalidTokenIdError().message
        }
      })
      expect(context.components.nfts.getNFTs).toHaveBeenCalledWith(getNFTParams(new Params(new URLSearchParams())), 'token')
    })
  })

  describe('when get nfts call throws MissingContractAddressParamError', () => {
    beforeEach(() => {
      context = {
        components: {
          nfts: {
            getNFTs: jest.fn().mockRejectedValue(new MissingContractAddressParamError())
          }
        },
        url: new URL('http://example.com/v1/nfts'),
        verification: {
          auth: 'TOKEN',
          authMetadata: {}
        }
      }
    })
    it('should return a bad request error when the contract address parameter is missing', async () => {
      const result = await getNFTsHandler(context)
      expect(result).toEqual({
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: new MissingContractAddressParamError().message
        }
      })
      expect(context.components.nfts.getNFTs).toHaveBeenCalledWith(getNFTParams(new Params(new URLSearchParams())), 'token')
    })
  })

  describe('when get nfts call throws an unknown error', () => {
    beforeEach(() => {
      context = {
        components: {
          nfts: {
            getNFTs: jest.fn().mockRejectedValue(new Error('Unknown error'))
          }
        },
        url: new URL('http://example.com/v1/nfts'),
        verification: {
          auth: 'TOKEN',
          authMetadata: {}
        }
      }
    })
    it('should return a bad request error when an unknown error occurs', async () => {
      const result = await getNFTsHandler(context)
      expect(result).toEqual({
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: 'Unknown error'
        }
      })
      expect(context.components.nfts.getNFTs).toHaveBeenCalledWith(getNFTParams(new Params(new URLSearchParams())), 'token')
    })
  })
})
