import { Request } from 'node-fetch'
import { ChainId, Event, Events, Trade, TradeCreation } from '@dcl/schemas'
import { addTradeHandler, getTradeAcceptedEventHandler, getTradeHandler } from '../../src/controllers/handlers/trades-handler'
import {
  DuplicatedBidError,
  EstateContractNotFoundForChainId,
  InvalidEstateTrade,
  EventNotGeneratedError,
  InvalidTradeSignatureError,
  InvalidTradeStructureError,
  TradeAlreadyExpiredError,
  TradeEffectiveAfterExpirationError,
  TradeNotFoundBySignatureError,
  TradeNotFoundError
} from '../../src/ports/trades/errors'
import { HandlerContextWithPath, StatusCode } from '../../src/types'

describe('when handling the creation of a new trade', () => {
  let context: Pick<HandlerContextWithPath<'trades', '/v1/trades'>, 'components' | 'request' | 'verification'>

  beforeEach(() => {
    context = {
      request: {} as any as Request,
      verification: {
        auth: 'signer',
        authMetadata: {}
      },
      components: {
        trades: {
          getTrades: jest.fn().mockResolvedValue({ data: [], count: 0 }),
          addTrade: jest.fn().mockResolvedValue({}),
          getTrade: jest.fn().mockResolvedValue({} as Trade),
          getTradeAcceptedEvent: jest.fn().mockResolvedValue({} as Event)
        }
      }
    }
  })

  describe('when request is missing authentication', () => {
    beforeEach(() => {
      context.verification = undefined
    })

    it('should return an HTTPResponse with status code 401', async () => {
      const result = await addTradeHandler(context)
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
    let response: Trade
    let body: TradeCreation
    let addTradeMock: jest.Mock

    beforeEach(() => {
      response = { id: 'trade-id' } as Trade
      body = { type: 'bid' } as TradeCreation
      addTradeMock = jest.fn().mockResolvedValue(response)
      context.request.json = jest.fn().mockResolvedValue(body)
      context.components.trades.addTrade = addTradeMock
    })

    it('should return an HTTPResponse with status code 201 and the added trade', async () => {
      const result = await addTradeHandler(context)
      expect(result).toEqual({
        status: 201,
        body: {
          ok: true,
          data: response
        }
      })
      expect(addTradeMock).toHaveBeenCalledWith(body, context.verification?.auth)
    })
  })

  describe('when the trade creation failed', () => {
    let addTradeMock: jest.Mock
    let body: TradeCreation

    describe.each([
      { errorName: 'TradeAlreadyExpiredError', error: new TradeAlreadyExpiredError(), code: StatusCode.BAD_REQUEST },
      { errorName: 'TradeEffectiveAfterExpirationError', error: new TradeEffectiveAfterExpirationError(), code: StatusCode.BAD_REQUEST },
      { errorName: 'InvalidTradeStructureError', error: new InvalidTradeStructureError('bid'), code: StatusCode.BAD_REQUEST },
      { errorName: 'InvalidTradeSignatureError', error: new InvalidTradeSignatureError(), code: StatusCode.BAD_REQUEST },
      { errorName: 'EstateTradeWithoutFingerprintError', error: new InvalidEstateTrade(), code: StatusCode.BAD_REQUEST },
      {
        errorName: 'EstateContractNotFoundForChainId',
        error: new EstateContractNotFoundForChainId(ChainId.AVALANCHE_MAINNET),
        code: StatusCode.BAD_REQUEST
      },
      { errorName: 'DuplicatedBidError', error: new DuplicatedBidError(), code: StatusCode.CONFLICT }
    ])('and the error is an instance of $errorName', ({ error, code }) => {
      beforeEach(() => {
        body = { type: 'bid' } as TradeCreation
        addTradeMock = jest.fn().mockRejectedValue(error)
        context.request.json = jest.fn().mockResolvedValue(body)
        context.components.trades.addTrade = addTradeMock
      })

      it(`should return an HTTPResponse with error status code ${code} and correct error message`, async () => {
        const result = await addTradeHandler(context)
        expect(result).toEqual({
          status: code,
          body: {
            ok: false,
            message: error.message
          }
        })

        expect(addTradeMock).toHaveBeenCalledWith(body, context.verification?.auth)
      })
    })

    describe('and there is an unexpected error', () => {
      let error: Error
      beforeEach(() => {
        error = new Error('Some error')
        body = { type: 'bid' } as TradeCreation
        addTradeMock = jest.fn().mockRejectedValue(error)
        context.request.json = jest.fn().mockResolvedValue(body)
        context.components.trades.addTrade = addTradeMock
      })
      it('should return an HTTPResponse with status code 500', async () => {
        const result = await addTradeHandler(context)
        expect(result).toEqual({
          status: StatusCode.ERROR,
          body: {
            ok: false,
            message: error.message
          }
        })

        expect(addTradeMock).toHaveBeenCalledWith(body, context.verification?.auth)
      })
    })
  })
})

describe('when handling the retrieval of a trade', () => {
  let context: Pick<HandlerContextWithPath<'trades', '/v1/trades/:id'>, 'components' | 'params'>

  describe('and the trade exists', () => {
    let trade: Trade

    beforeEach(() => {
      trade = { id: 'trade-id' } as Trade

      context = {
        params: {
          id: trade.id
        },
        components: {
          trades: {
            getTrades: jest.fn().mockResolvedValue({ data: [], count: 0 }),
            addTrade: jest.fn().mockResolvedValue({}),
            getTrade: jest.fn().mockResolvedValue(trade),
            getTradeAcceptedEvent: jest.fn().mockResolvedValue({} as Event)
          }
        }
      }
    })

    it('should return trade', async () => {
      const result = await getTradeHandler(context)
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          ok: true,
          data: trade
        }
      })
    })
  })

  describe('and the trade does not exist', () => {
    let trade: Trade
    let error: TradeNotFoundError

    beforeEach(() => {
      trade = { id: 'trade-id' } as Trade
      error = new TradeNotFoundError(trade.id)
      context = {
        params: {
          id: trade.id
        },
        components: {
          trades: {
            getTrades: jest.fn().mockResolvedValue({ data: [], count: 0 }),
            addTrade: jest.fn().mockResolvedValue({}),
            getTrade: jest.fn().mockRejectedValue(error),
            getTradeAcceptedEvent: jest.fn().mockResolvedValue({} as Event)
          }
        }
      }
    })

    it('should return not found error', async () => {
      const result = await getTradeHandler(context)
      expect(result).toEqual({
        status: StatusCode.NOT_FOUND,
        body: {
          ok: false,
          message: error.message
        }
      })
    })
  })

  describe('and there was a unexpected error', () => {
    let trade: Trade
    let error: Error

    beforeEach(() => {
      trade = { id: 'trade-id' } as Trade
      error = new Error('Some unexpected error')

      context = {
        params: {
          id: trade.id
        },
        components: {
          trades: {
            getTrades: jest.fn().mockResolvedValue({ data: [], count: 0 }),
            addTrade: jest.fn().mockResolvedValue({}),
            getTrade: jest.fn().mockRejectedValue(error),
            getTradeAcceptedEvent: jest.fn().mockResolvedValue({} as Event)
          }
        }
      }
    })

    it('should return not found error', async () => {
      const result = await getTradeHandler(context)
      expect(result).toEqual({
        status: StatusCode.ERROR,
        body: {
          ok: false,
          message: error.message
        }
      })
    })
  })
})

describe('when handling the retrieval of a trade accepted event', () => {
  let context: Pick<HandlerContextWithPath<'trades', '/v1/trades/:hashedSignature/accept'>, 'components' | 'params' | 'url'>
  beforeEach(() => {
    context = {
      params: {
        hashedSignature: 'asignature'
      },
      url: new URL('http://test.com/v1/trades/asignature/accept'),
      components: {
        trades: {
          getTrades: jest.fn().mockResolvedValue({ data: [], count: 0 }),
          addTrade: jest.fn().mockResolvedValue({}),
          getTrade: jest.fn().mockResolvedValue({}),
          getTradeAcceptedEvent: jest.fn().mockResolvedValue({} as Event)
        }
      }
    }
  })

  describe('and the trade does not exist', () => {
    beforeEach(() => {
      context.components.trades.getTradeAcceptedEvent = jest.fn().mockRejectedValue(new TradeNotFoundBySignatureError('asignature'))
    })

    it('should return a not found error', async () => {
      const result = await getTradeAcceptedEventHandler(context)
      expect(result).toEqual({
        status: StatusCode.NOT_FOUND,
        body: {
          ok: false,
          message: new TradeNotFoundBySignatureError('asignature').message
        }
      })
    })
  })

  describe('and the event could not be created', () => {
    beforeEach(() => {
      context.components.trades.getTradeAcceptedEvent = jest.fn().mockRejectedValue(new EventNotGeneratedError())
    })

    it('should return a not found error', async () => {
      const result = await getTradeAcceptedEventHandler(context)
      expect(result).toEqual({
        status: StatusCode.ERROR,
        body: {
          ok: false,
          message: new EventNotGeneratedError().message
        }
      })
    })
  })

  describe('and there was a unexpected error', () => {
    beforeEach(() => {
      context.components.trades.getTradeAcceptedEvent = jest.fn().mockRejectedValue(new Error('message'))
    })

    it('should return a not found error', async () => {
      const result = await getTradeAcceptedEventHandler(context)
      expect(result).toEqual({
        status: StatusCode.ERROR,
        body: {
          ok: false,
          message: 'message'
        }
      })
    })
  })

  describe('and the event was created successfully', () => {
    let event: Event
    beforeEach(() => {
      event = { type: Events.Type.MARKETPLACE } as Event
      context.components.trades.getTradeAcceptedEvent = jest.fn().mockResolvedValue(event)
    })

    it('should return the event', async () => {
      const result = await getTradeAcceptedEventHandler(context)
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          ok: true,
          data: event
        }
      })
    })
  })
})
