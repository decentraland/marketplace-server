import { Request } from 'node-fetch'
import { addTradeHandler } from '../../src/controllers/handlers/trades-handler'
import { StatusCode } from '../../src/types'
import { RequestError } from '../../src/utils'

describe('addTradeHandler', () => {
  describe('when request is missing authentication', () => {
    it('should return an HTTPResponse with status code 401', async () => {
      const context = {
        verification: {
          auth: null
        },
        components: {
          trades: {
            getTrades: jest.fn().mockResolvedValue({ data: [], count: 0 }),
            addTrade: jest.fn().mockResolvedValue({})
          }
        }
      }
      const result = await addTradeHandler(context as any)
      expect(result).toEqual({
        status: 401,
        body: {
          ok: false,
          message: 'Unauthorized'
        }
      })
    })
  })

  describe('when trade was created successfully', () => {
    it('should return an HTTPResponse with status code 201 and the added trade', async () => {
      const response = { id: 'trade-id' }
      const body = { type: 'bid' }
      const context = {
        request: {
          json: jest.fn().mockResolvedValue(body)
        } as any as Request,
        components: {
          trades: {
            getTrades: jest.fn().mockResolvedValue({ data: [], count: 0 }),
            addTrade: jest.fn().mockResolvedValue(response)
          }
        },
        verification: {
          auth: 'signer',
          authMetadata: {}
        }
      }
      const result = await addTradeHandler(context)
      expect(result).toEqual({
        status: 201,
        body: {
          ok: true,
          data: response
        }
      })

      expect(context.components.trades.addTrade).toHaveBeenCalledWith(body, 'signer')
    })
  })

  describe('when trade creation failed', () => {
    describe('and the error is an instance of RequestError', () => {
      it('should return an HTTPResponse with error status code and message', async () => {
        const error = new RequestError(StatusCode.CONFLICT, 'Invalid trade')
        const body = { type: 'bid' }
        const context = {
          request: {
            json: jest.fn().mockResolvedValue(body)
          } as any as Request,
          components: {
            trades: {
              getTrades: jest.fn().mockResolvedValue({ data: [], count: 0 }),
              addTrade: jest.fn().mockRejectedValue(error)
            }
          },
          verification: {
            auth: 'signer',
            authMetadata: {}
          }
        }
        const result = await addTradeHandler(context)
        expect(result).toEqual({
          status: error.statusCode,
          body: {
            ok: false,
            message: error.message
          }
        })

        expect(context.components.trades.addTrade).toHaveBeenCalledWith(body, 'signer')
      })
    })

    describe('and there is an unexpected error', () => {
      it('should return an HTTPResponse with status code 400', async () => {
        const error = new Error('Some error')
        const body = { type: 'bid' }
        const context = {
          request: {
            json: jest.fn().mockResolvedValue(body)
          } as any as Request,
          components: {
            trades: {
              getTrades: jest.fn().mockResolvedValue({ data: [], count: 0 }),
              addTrade: jest.fn().mockRejectedValue(error)
            }
          },
          verification: {
            auth: 'signer',
            authMetadata: {}
          }
        }
        const result = await addTradeHandler(context)
        expect(result).toEqual({
          status: StatusCode.BAD_REQUEST,
          body: {
            ok: false,
            message: 'Trade could not be created'
          }
        })

        expect(context.components.trades.addTrade).toHaveBeenCalledWith(body, 'signer')
      })
    })
  })
})
