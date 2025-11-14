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
let mockDateNow: jest.SpyInstance

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
  if (mockDateNow) {
    mockDateNow.mockRestore()
  }
})

describe('when getting or refreshing an access token', () => {
  let currentTime: number
  let newAccessToken: string
  let expiresAt: number
  let mockTokenResponse: { data: { accessToken: string; expiresAt: number } }

  beforeEach(() => {
    currentTime = 1609459200000 // Fixed timestamp: 2021-01-01T00:00:00.000Z
    newAccessToken = 'new-access-token'
    expiresAt = fromMillisecondsToSeconds(currentTime) + 3600 // 1 hour from now (in seconds)
    mockTokenResponse = {
      data: {
        accessToken: newAccessToken,
        expiresAt: expiresAt
      }
    }
    mockDateNow = jest.spyOn(Date, 'now').mockReturnValue(currentTime)
  })

  describe('and the access token is cached', () => {
    let cachedAccessToken: string

    beforeEach(() => {
      cachedAccessToken = 'cached-access-token'
      mockTryAcquireLock.mockResolvedValue(true)
      mockGet.mockResolvedValue(cachedAccessToken)
    })

    describe('and force is false', () => {
      it('should return the cached access token without refreshing', async () => {
        const result = await transakComponent.getOrRefreshAccessToken(false)

        expect(mockTryAcquireLock).toHaveBeenCalledWith('transak-access-token-lock', {
          ttlInMilliseconds: 30000,
          retryDelayInMilliseconds: 250,
          retries: 30
        })
        expect(mockGet).toHaveBeenCalledWith('transak-access-token')
        expect(mockFetch).not.toHaveBeenCalled()
        expect(mockSet).not.toHaveBeenCalled()
        expect(mockTryReleaseLock).toHaveBeenCalledWith('transak-access-token-lock')
        expect(result).toEqual(cachedAccessToken)
      })
    })

    describe('and force is true', () => {
      beforeEach(() => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: jest.fn().mockResolvedValue(mockTokenResponse)
        } as any)
      })

      it('should refresh the access token and cache it even when a cached token exists', async () => {
        const result = await transakComponent.getOrRefreshAccessToken(true)

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
        expect(mockSet).toHaveBeenCalledWith('transak-access-token', newAccessToken, fromMillisecondsToSeconds(3600000))
        expect(mockTryReleaseLock).toHaveBeenCalledWith('transak-access-token-lock')
        expect(result).toEqual(newAccessToken)
      })
    })
  })

  describe('and the access token is not cached', () => {
    beforeEach(() => {
      mockTryAcquireLock.mockResolvedValue(true)
      mockGet.mockResolvedValue(null)
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockTokenResponse)
      } as any)
    })

    describe('and force is false', () => {
      it('should fetch and cache a new access token', async () => {
        const result = await transakComponent.getOrRefreshAccessToken(false)

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
        expect(mockSet).toHaveBeenCalledWith('transak-access-token', newAccessToken, fromMillisecondsToSeconds(3600000))
        expect(mockTryReleaseLock).toHaveBeenCalledWith('transak-access-token-lock')
        expect(result).toEqual(newAccessToken)
      })
    })

    describe('and force is true', () => {
      it('should fetch and cache a new access token', async () => {
        const result = await transakComponent.getOrRefreshAccessToken(true)

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
        expect(mockSet).toHaveBeenCalledWith('transak-access-token', newAccessToken, fromMillisecondsToSeconds(3600000))
        expect(mockTryReleaseLock).toHaveBeenCalledWith('transak-access-token-lock')
        expect(result).toEqual(newAccessToken)
      })
    })
  })

  describe('and the lock cannot be acquired', () => {
    beforeEach(() => {
      mockTryAcquireLock.mockResolvedValue(false)
    })

    it('should throw an error indicating lock acquisition failed', async () => {
      await expect(transakComponent.getOrRefreshAccessToken(false)).rejects.toThrow('Failed to acquire lock')

      expect(mockTryAcquireLock).toHaveBeenCalledWith('transak-access-token-lock', {
        ttlInMilliseconds: 30000,
        retryDelayInMilliseconds: 250,
        retries: 30
      })
      expect(mockGet).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
      expect(mockTryReleaseLock).not.toHaveBeenCalled()
    })
  })

  describe('and the token refresh request fails', () => {
    beforeEach(() => {
      mockTryAcquireLock.mockResolvedValue(true)
      mockGet.mockResolvedValue(null)
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401
      } as any)
    })

    it('should throw an error and release the lock', async () => {
      await expect(transakComponent.getOrRefreshAccessToken(false)).rejects.toThrow('Error refreshing access token, status: 401')

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
      await expect(transakComponent.getOrRefreshAccessToken(false)).rejects.toThrow('Network connection failed')

      expect(mockTryReleaseLock).toHaveBeenCalledWith('transak-access-token-lock')
    })
  })
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
    let currentTime: number
    let mockTokenResponse: { data: { accessToken: string; expiresAt: number } }

    beforeEach(() => {
      currentTime = 1609459200000 // Fixed timestamp: 2021-01-01T00:00:00.000Z
      newAccessToken = 'new-access-token'
      expiresAt = fromMillisecondsToSeconds(currentTime) + 3600 // 1 hour from now (in seconds)
      mockTokenResponse = {
        data: {
          accessToken: newAccessToken,
          expiresAt: expiresAt
        }
      }

      mockDateNow = jest.spyOn(Date, 'now').mockReturnValue(currentTime)
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

    it('should refresh the access token and cache it with the TTL based on the expiration time', async () => {
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
      expect(mockSet).toHaveBeenCalledWith('transak-access-token', newAccessToken, fromMillisecondsToSeconds(3600000))
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
    let currentTime: number

    beforeEach(() => {
      currentTime = 1609459200000 // Fixed timestamp: 2021-01-01T00:00:00.000Z
      newAccessToken = 'new-access-token'
      expiresAt = fromMillisecondsToSeconds(currentTime) + 3600 // 1 hour from now (in seconds)
      mockDateNow = jest.spyOn(Date, 'now').mockReturnValue(currentTime)
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

    it('should refresh the token, cache it with correct TTL, and call the auth session endpoint', async () => {
      const result = await transakComponent.getWidget()

      expect(mockFetch).toHaveBeenNthCalledWith(1, `${mockConfig.apiURL}/v2/refresh-token`, {
        method: 'POST',
        headers: { 'api-secret': mockConfig.apiSecret, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: mockConfig.apiKey })
      })

      expect(mockSet).toHaveBeenCalledWith('transak-access-token', newAccessToken, fromMillisecondsToSeconds(3600000))

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
