import { URL } from 'url'
import { Bid, ChainId, ListingStatus, Network } from '@dcl/schemas'
import { getBidsHandler } from '../../src/controllers/handlers/bids-handler'
import { HTTPResponse, HandlerContextWithPath, PaginatedResponse, StatusCode } from '../../src/types'

let bids: Bid[]

describe('when fetching bids', () => {
  let context: Pick<HandlerContextWithPath<'bids', '/v1/bids'>, 'components' | 'url'>
  let getBidsMock: jest.Mock
  let response: HTTPResponse<PaginatedResponse<Bid>>

  beforeEach(() => {
    bids = [
      {
        id: '123',
        status: ListingStatus.CANCELLED,
        seller: '',
        tradeId: '1',
        price: '10',
        tokenId: '1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        network: Network.ETHEREUM,
        chainId: ChainId.ETHEREUM_SEPOLIA,
        bidder: '0x1',
        contractAddress: '0x1',
        expiresAt: Date.now(),
        fingerprint: '123'
      }
    ]

    getBidsMock = jest.fn().mockResolvedValue({ data: bids, count: 1 })

    context = {
      url: new URL('http://localhost:3000/v1/bids'),
      components: { bids: { getBids: getBidsMock } }
    }
  })

  describe('and the limit parameter is defined in the url', () => {
    beforeEach(async () => {
      context.url = new URL('http://localhost:3000/v1/bids?limit=1')

      response = await getBidsHandler(context)
    })

    it('should fetch bids with the correct limit', () => {
      expect(getBidsMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }))
    })

    it('should return the correct data and count', () => {
      expect(response).toEqual({
        status: StatusCode.OK,
        body: {
          ok: true,
          data: {
            results: bids,
            total: 1,
            page: 0,
            pages: 1,
            limit: 1
          }
        }
      })
    })
  })

  describe('and the offset parameter is defined in the url', () => {
    beforeEach(async () => {
      context.url = new URL('http://localhost:3000/v1/bids?offset=1')

      response = await getBidsHandler(context)
    })

    it('should fetch bids with the correct offset', () => {
      expect(getBidsMock).toHaveBeenCalledWith(expect.objectContaining({ offset: 1 }))
    })

    it('should return the correct data and count', () => {
      expect(response).toEqual({
        status: StatusCode.OK,
        body: {
          ok: true,
          data: {
            results: bids,
            total: 1,
            page: 0,
            pages: 1,
            limit: 100
          }
        }
      })
    })
  })

  describe('and neither the limit nor the offset parameter is defined in the url', () => {
    beforeEach(async () => {
      context.url = new URL('http://localhost:3000/v1/bids')

      response = await getBidsHandler(context)
    })

    it('should fetch bids with the default limit and offset values', () => {
      expect(getBidsMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, offset: 0 }))
    })
  })

  describe('and the sortBy parameter is defined in the url', () => {
    beforeEach(async () => {
      context.url = new URL('http://localhost:3000/v1/bids?sortBy=recently_offered')

      response = await getBidsHandler(context)
    })

    it('should fetch bids with the correct sortBy', () => {
      expect(getBidsMock).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'recently_offered' }))
    })

    it('should return the correct data and count', () => {
      expect(response).toEqual({
        status: StatusCode.OK,
        body: {
          ok: true,
          data: {
            results: bids,
            total: 1,
            page: 0,
            pages: 1,
            limit: 100
          }
        }
      })
    })
  })

  describe('and the bidder parameter is defined in the url', () => {
    beforeEach(async () => {
      context.url = new URL('http://localhost:3000/v1/bids?bidder=0x123')

      response = await getBidsHandler(context)
    })

    it('should fetch bids with the correct bidder', () => {
      expect(getBidsMock).toHaveBeenCalledWith(expect.objectContaining({ bidder: '0x123' }))
    })

    it('should return the correct data and count', () => {
      expect(response).toEqual({
        status: StatusCode.OK,
        body: {
          ok: true,
          data: {
            results: bids,
            total: 1,
            page: 0,
            pages: 1,
            limit: 100
          }
        }
      })
    })
  })

  describe('and there is an error fetching the bids', () => {
    let error: Error

    beforeEach(async () => {
      context.url = new URL('http://localhost:3000/v1/bids?bidder=0x123')

      error = new Error('Failed to fetch bids')
      getBidsMock.mockRejectedValue(error)

      response = await getBidsHandler(context)
    })
    it('should return response with status ERROR', async () => {
      expect(response).toEqual({
        status: StatusCode.ERROR,
        body: {
          ok: false,
          message: error.message
        }
      })
    })
  })
})
