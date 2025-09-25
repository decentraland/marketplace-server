import { IFetchComponent } from '@well-known-components/http-server'
import { createLoggerMockedComponent, ICacheStorageComponent } from '@dcl/core-commons'
import { fromMillisecondsToSeconds } from '../../src/logic/date'
import { createTransakComponent } from '../../src/ports/transak/component'
import { ITransakComponent, OrderResponse, TransakOrderStatus } from '../../src/ports/transak/types'
import { createCacheMockedComponent } from '../mocks/cache-mock'

let transakComponent: ITransakComponent
let mockConfig: { apiURL: string; apiKey: string; apiSecret: string }
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

describe('when the lock is always released', () => {
  let orderId: string

  beforeEach(() => {
    orderId = 'test-order-id'
    mockTryAcquireLock.mockResolvedValue(true)
  })

  describe('and an error occurs during token refresh', () => {
    beforeEach(() => {
      mockGet.mockResolvedValue(null)
      mockFetch.mockRejectedValue(new Error('Token refresh failed'))
    })

    it('should always release the lock even when errors occur', async () => {
      await expect(transakComponent.getOrder(orderId)).rejects.toThrow()

      expect(mockTryReleaseLock).toHaveBeenCalledWith('transak-access-token-lock')
    })
  })

  describe('and an error occurs during order fetch', () => {
    beforeEach(() => {
      mockGet.mockResolvedValue('valid-token')
      mockFetch.mockRejectedValue(new Error('Order fetch failed'))
    })

    it('should always release the lock even when order fetch fails', async () => {
      await expect(transakComponent.getOrder(orderId)).rejects.toThrow()

      expect(mockTryReleaseLock).toHaveBeenCalledWith('transak-access-token-lock')
    })
  })

  describe('and the cache set operation fails', () => {
    beforeEach(() => {
      mockGet.mockResolvedValue(null)
      mockSet.mockRejectedValue(new Error('Cache set failed'))
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: { accessToken: 'new-token', expiresAt: Date.now() + 3600000 }
        })
      } as any)
    })

    it('should release the lock when cache operations fail', async () => {
      await expect(transakComponent.getOrder(orderId)).rejects.toThrow()

      expect(mockTryReleaseLock).toHaveBeenCalledWith('transak-access-token-lock')
    })
  })
})
