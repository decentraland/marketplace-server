import { IFetchComponent } from '@well-known-components/http-server'
import { createLoggerMockedComponent, ICacheStorageComponent } from '@dcl/core-commons'
import { fromMillisecondsToSeconds } from '../../src/logic/date'
import { createTransakComponent } from '../../src/ports/transak/component'
import { ITransakComponent, OrderResponse, TransakOrderStatus } from '../../src/ports/transak/types'
import { createCacheMockedComponent } from '../mocks/cache-mock'

let transakComponent: ITransakComponent
let mockConfig: { apiURL: string; apiKey: string; apiSecret: string; apiGatewayURL: string; marketplaceURL: string }
let mockFetch: jest.MockedFn<IFetchComponent['fetch']>
let mockGet: jest.MockedFn<ICacheStorageComponent['get']>
let mockSet: jest.MockedFn<ICacheStorageComponent['set']>
let mockTryAcquireLock: jest.MockedFn<ICacheStorageComponent['tryAcquireLock']>
let mockTryReleaseLock: jest.MockedFn<ICacheStorageComponent['tryReleaseLock']>

beforeEach(() => {
  mockGet = jest.fn()
  mockSet = jest.fn()
  mockTryAcquireLock = jest.fn()
  mockTryReleaseLock = jest.fn()
  mockFetch = jest.fn()

  mockConfig = {
    apiURL: 'https://api.transak.com',
    apiGatewayURL: 'https://api-gateway.transak.com',
    marketplaceURL: 'https://decentraland.org/marketplace',
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret'
  }

  const logs = createLoggerMockedComponent()
  const cache = createCacheMockedComponent({
    get: mockGet as any,
    set: mockSet,
    tryAcquireLock: mockTryAcquireLock,
    tryReleaseLock: mockTryReleaseLock
  })

  const fetch = {
    fetch: mockFetch
  } as jest.Mocked<IFetchComponent>

  transakComponent = createTransakComponent({ fetch, logs, cache }, mockConfig)
})

afterEach(() => {
  jest.resetAllMocks()
})

describe('when getting an order', () => {
  let orderId: string
  let mockOrderResponse: OrderResponse

  beforeEach(() => {
    orderId = 'test-order-id-123'
    mockOrderResponse = {
      meta: {
        orderId: 'test-order-id-123'
      },
      data: {
        id: 'test-order-id-123',
        status: TransakOrderStatus.COMPLETED,
        transactionHash: '0x1234567890abcdef',
        walletAddress: '0xabcdef1234567890',
        errorMessage: null
      }
    }
  })

  describe('and the access token is cached and valid', () => {
    let cachedAccessToken: string

    beforeEach(() => {
      cachedAccessToken = 'cached-access-token'
      mockTryAcquireLock.mockResolvedValue(true)
      mockGet.mockResolvedValue(cachedAccessToken)
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockOrderResponse)
      } as any)
    })

    it('should return the order data using cached access token', async () => {
      const result = await transakComponent.getOrder(orderId)

      expect(mockTryAcquireLock).toHaveBeenCalledWith('transak-access-token-lock', {
        ttlInMilliseconds: 30000,
        retryDelayInMilliseconds: 250,
        retries: 30
      })
      expect(mockGet).toHaveBeenCalledWith('transak-access-token')
      expect(mockFetch).toHaveBeenCalledWith(`${mockConfig.apiURL}/v2/order/${orderId}`, {
        method: 'GET',
        headers: { 'access-token': cachedAccessToken }
      })
      expect(mockTryReleaseLock).toHaveBeenCalledWith('transak-access-token-lock')
      expect(result).toEqual(mockOrderResponse)
    })
  })

  describe('and the access token is not cached', () => {
    let newAccessToken: string
    let expiresAt: number
    let mockTokenResponse: { data: { accessToken: string; expiresAt: number } }

    beforeEach(() => {
      newAccessToken = 'new-access-token'
      expiresAt = Date.now() + 3600000 // 1 hour from now
      mockTokenResponse = {
        data: {
          accessToken: newAccessToken,
          expiresAt: expiresAt
        }
      }

      mockTryAcquireLock.mockResolvedValue(true)
      mockGet.mockResolvedValue(null)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockTokenResponse)
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockOrderResponse)
        } as any)
    })

    it('should refresh the access token and return the order data', async () => {
      const result = await transakComponent.getOrder(orderId)

      expect(mockTryAcquireLock).toHaveBeenCalledWith('transak-access-token-lock', {
        ttlInMilliseconds: 30000,
        retryDelayInMilliseconds: 250,
        retries: 30
      })
      expect(mockGet).toHaveBeenCalledWith('transak-access-token')
      expect(mockFetch).toHaveBeenCalledWith(`${mockConfig.apiURL}/v2/refresh-token`, {
        method: 'POST',
        headers: {
          'api-secret': mockConfig.apiSecret,
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ apiKey: mockConfig.apiKey })
      })
      expect(mockSet).toHaveBeenCalledWith('transak-access-token', newAccessToken, fromMillisecondsToSeconds(expiresAt))
      expect(mockFetch).toHaveBeenCalledWith(`${mockConfig.apiURL}/v2/order/${orderId}`, {
        method: 'GET',
        headers: { 'access-token': newAccessToken }
      })
      expect(mockTryReleaseLock).toHaveBeenCalledWith('transak-access-token-lock')
      expect(result).toEqual(mockOrderResponse)
    })
  })

  describe('and the lock cannot be acquired', () => {
    beforeEach(() => {
      mockTryAcquireLock.mockResolvedValue(false)
    })

    it('should throw an error when lock cannot be acquired', async () => {
      await expect(transakComponent.getOrder(orderId)).rejects.toThrow('Failed to acquire lock')

      expect(mockTryAcquireLock).toHaveBeenCalledWith('transak-access-token-lock', {
        ttlInMilliseconds: 30000,
        retryDelayInMilliseconds: 250,
        retries: 30
      })
      expect(mockGet).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('and the token refresh fails', () => {
    beforeEach(() => {
      mockTryAcquireLock.mockResolvedValue(true)
      mockGet.mockResolvedValue(null)
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401
      } as any)
    })

    it('should throw an error and release the lock', async () => {
      await expect(transakComponent.getOrder(orderId)).rejects.toThrow('Error refreshing access token, status: 401')

      expect(mockTryReleaseLock).toHaveBeenCalledWith('transak-access-token-lock')
    })
  })

  describe('and the order request fails', () => {
    beforeEach(() => {
      mockTryAcquireLock.mockResolvedValue(true)
      mockGet.mockResolvedValue('valid-token')
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404
      } as any)
    })

    it('should throw an error with the status code', async () => {
      await expect(transakComponent.getOrder(orderId)).rejects.toThrow('Error getting order, status: 404')

      expect(mockTryReleaseLock).toHaveBeenCalledWith('transak-access-token-lock')
    })
  })

  describe('and there is a network error during token refresh', () => {
    let networkError: Error

    beforeEach(() => {
      networkError = new Error('Network connection failed')
      mockTryAcquireLock.mockResolvedValue(true)
      mockGet.mockResolvedValue(null)
      mockFetch.mockRejectedValue(networkError)
    })

    it('should propagate the network error and release the lock', async () => {
      await expect(transakComponent.getOrder(orderId)).rejects.toThrow('Network connection failed')

      expect(mockTryReleaseLock).toHaveBeenCalledWith('transak-access-token-lock')
    })
  })

  describe('and there is a network error during order request', () => {
    let networkError: Error

    beforeEach(() => {
      networkError = new Error('Order API unavailable')
      mockTryAcquireLock.mockResolvedValue(true)
      mockGet.mockResolvedValue('valid-token')
      mockFetch.mockRejectedValue(networkError)
    })

    it('should propagate the network error and release the lock', async () => {
      await expect(transakComponent.getOrder(orderId)).rejects.toThrow('Order API unavailable')

      expect(mockTryReleaseLock).toHaveBeenCalledWith('transak-access-token-lock')
    })
  })
})

describe('when getting a widget session URL', () => {
  let widgetUrl: string
  let cachedAccessToken: string

  beforeEach(() => {
    widgetUrl = 'https://widget.transak.com/?session=abc123'
    cachedAccessToken = 'cached-access-token'
  })

  describe('and the access token is cached and valid', () => {
    beforeEach(() => {
      ;(mockTryAcquireLock as jest.Mock).mockResolvedValue(true)
      ;(mockGet as jest.Mock).mockResolvedValue(cachedAccessToken)
      ;(mockFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: { widgetUrl } })
      } as any)
    })

    it('should call the auth session endpoint and return the widget url', async () => {
      const result = await transakComponent.getWidget({ fiatAmount: 100, fiatCurrency: 'USD' })

      expect(mockFetch).toHaveBeenCalledWith(`${mockConfig.apiGatewayURL}/v2/auth/session`, {
        method: 'POST',
        headers: { 'access-token': cachedAccessToken, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          widgetParams: {
            apiKey: mockConfig.apiKey,
            referrerDomain: new URL(mockConfig.marketplaceURL).hostname,
            networks: 'ethereum,polygon',
            cryptoCurrencyCode: 'MANA',
            defaultCryptoCurrency: 'MANA',
            cyptoCurrencyList: 'MANA',
            fiatAmount: 100,
            fiatCurrency: 'USD'
          }
        })
      })
      expect(result).toEqual(widgetUrl)
    })
  })

  describe('and the access token is not cached', () => {
    let newAccessToken: string
    let expiresAt: number

    beforeEach(() => {
      newAccessToken = 'new-access-token'
      expiresAt = Date.now() + 3600000
      ;(mockTryAcquireLock as jest.Mock).mockResolvedValue(true)
      ;(mockGet as jest.Mock).mockResolvedValue(null)
      ;(mockFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ data: { accessToken: newAccessToken, expiresAt } })
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ data: { widgetUrl } })
        } as any)
    })

    it('should refresh the token and then call the auth session endpoint', async () => {
      const result = await transakComponent.getWidget()

      expect(mockFetch).toHaveBeenNthCalledWith(1, `${mockConfig.apiURL}/v2/refresh-token`, {
        method: 'POST',
        headers: { 'api-secret': mockConfig.apiSecret, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: mockConfig.apiKey })
      })

      expect(mockFetch).toHaveBeenNthCalledWith(2, `${mockConfig.apiGatewayURL}/v2/auth/session`, {
        method: 'POST',
        headers: { 'access-token': newAccessToken, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          widgetParams: {
            apiKey: mockConfig.apiKey,
            referrerDomain: new URL(mockConfig.marketplaceURL).hostname,
            networks: 'ethereum,polygon',
            cryptoCurrencyCode: 'MANA',
            defaultCryptoCurrency: 'MANA',
            cyptoCurrencyList: 'MANA'
          }
        })
      })

      expect(result).toEqual(widgetUrl)
    })
  })

  describe('and the session request fails', () => {
    beforeEach(() => {
      ;(mockTryAcquireLock as jest.Mock).mockResolvedValue(true)
      ;(mockGet as jest.Mock).mockResolvedValue('valid-token')
      ;(mockFetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({ data: { widgetUrl: '' } })
      } as any)
    })

    it('should throw with status code', async () => {
      await expect(transakComponent.getWidget()).rejects.toThrow('Error getting widget, status: 500')
    })
  })
})
