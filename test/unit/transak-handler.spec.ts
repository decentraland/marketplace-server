import { Request } from 'node-fetch'
import { createTransakHandler, createTransakWidgetHandler } from '../../src/controllers/handlers/transak-handler'
import { HandlerContextWithPath, StatusCode } from '../../src/types'

describe('when handling Transak endpoints', () => {
  describe('when getting a Transak order', () => {
    let context: Pick<
      HandlerContextWithPath<'transak', '/v1/transak/orders/:id'>,
      'url' | 'components' | 'request' | 'verification' | 'params'
    >

    beforeEach(() => {
      context = {
        url: new URL('http://localhost/v1/transak/orders/an-order-id'),
        request: {} as Request,
        verification: {
          auth: '0xABCDEF1234567890',
          authMetadata: {}
        },
        params: { id: 'an-order-id' },
        components: {
          transak: {
            getOrder: jest.fn().mockResolvedValue({
              meta: { orderId: 'an-order-id' },
              data: {
                id: 'an-order-id',
                status: 'COMPLETED',
                transactionHash: '0x0',
                walletAddress: '0xabcdef1234567890',
                errorMessage: null
              }
            }),
            getWidget: jest.fn()
          }
        }
      }
    })

    describe('and the user is not authenticated', () => {
      beforeEach(() => {
        context.verification = undefined
      })

      it('should return an HTTPResponse with status code 401', async () => {
        const result = await createTransakHandler(context)
        expect(result).toEqual({
          status: StatusCode.UNAUTHORIZED,
          body: { ok: false, message: 'Unauthorized' }
        })
      })
    })

    describe('and the authenticated user does not match the order wallet', () => {
      beforeEach(() => {
        context.verification = { auth: '0x0000000000000000000000000000000000000000', authMetadata: {} }
      })

      it('should return 401 unauthorized', async () => {
        const result = await createTransakHandler(context)
        expect(result).toEqual({
          status: StatusCode.UNAUTHORIZED,
          body: { ok: false, message: 'Unauthorized' }
        })
      })
    })

    describe('and the authenticated user matches the order wallet', () => {
      beforeEach(() => {
        context.verification = { auth: '0xabcdef1234567890', authMetadata: {} }
      })

      it('should return 200 with the order payload wrapped in ok:true', async () => {
        const result = await createTransakHandler(context)
        expect(result.status).toBe(StatusCode.OK)
        expect(result.body).toEqual({
          ok: true,
          data: expect.objectContaining({ meta: { orderId: 'an-order-id' } })
        })
      })
    })
  })

  describe('when getting the Transak widget URL', () => {
    let context: Pick<HandlerContextWithPath<'transak', '/v1/transak/widget'>, 'components' | 'request'>
    let widgetOptions: Record<string, unknown>
    let mockGetWidget: jest.Mock
    let mockJson: jest.Mock

    beforeEach(() => {
      widgetOptions = {}
      mockGetWidget = jest.fn().mockResolvedValue('https://widget-url')
      mockJson = jest.fn().mockImplementation(() => Promise.resolve(widgetOptions))
      context = {
        components: {
          transak: {
            getWidget: mockGetWidget,
            getOrder: jest.fn()
          }
        },
        request: {
          json: mockJson
        } as unknown as Request
      }
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    describe('and widget options are provided', () => {
      beforeEach(() => {
        widgetOptions = {
          fiatAmount: 150,
          fiatCurrency: 'EUR'
        }
      })

      it('should call getWidget with provided options and return 200 with the widget URL', async () => {
        const result = await createTransakWidgetHandler(context)

        expect(mockGetWidget).toHaveBeenCalledWith({
          fiatAmount: 150,
          fiatCurrency: 'EUR'
        })

        expect(result).toEqual({
          status: StatusCode.OK,
          body: { ok: true, data: 'https://widget-url' }
        })
      })
    })

    describe('and widget options are empty', () => {
      beforeEach(() => {
        widgetOptions = {}
      })

      it('should call getWidget with empty options and return 200 with the widget URL', async () => {
        const result = await createTransakWidgetHandler(context)

        expect(mockGetWidget).toHaveBeenCalledWith({})

        expect(result).toEqual({
          status: StatusCode.OK,
          body: { ok: true, data: 'https://widget-url' }
        })
      })
    })

    describe('and getWidget throws an unknown error', () => {
      beforeEach(() => {
        mockGetWidget.mockRejectedValue(new Error('Something went wrong'))
      })

      it('should respond with a 500 and the error message', async () => {
        const result = await createTransakWidgetHandler(context)

        expect(result).toEqual({
          status: StatusCode.INTERNAL_SERVER_ERROR,
          body: { ok: false, message: 'Something went wrong' }
        })
      })
    })
  })
})
