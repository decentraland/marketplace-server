import { fromMillisecondsToSeconds } from '../../logic/date'
import { isErrorWithMessage } from '../../logic/errors'
import { AppComponents } from '../../types'
import { WidgetOptions, ITransakComponent, OrderResponse } from './types'

const TRANSAK_ACCESS_TOKEN_LOCK_KEY = 'transak-access-token-lock'
const TRANSAK_ACCESS_TOKEN_CACHE_KEY = 'transak-access-token'
const THIRTY_SECONDS_IN_MILLISECONDS = 30 * 1000
const RETRY_DELAY_IN_MILLISECONDS = 250
const LOCK_RETRIES = 30

export function createTransakComponent(
  components: Pick<AppComponents, 'fetch' | 'logs' | 'cache'>,
  {
    apiURL,
    marketplaceURL,
    apiGatewayURL,
    apiKey,
    apiSecret
  }: {
    marketplaceURL: string
    apiURL: string
    apiGatewayURL: string
    apiKey: string
    apiSecret: string
  }
): ITransakComponent {
  const { fetch, logs, cache } = components
  const logger = logs.getLogger('Transak')
  const marketplaceDomain = new URL(marketplaceURL).hostname
  /**
   * Retrieves a cached access token or refreshes it if not available.
   * Uses a distributed lock to prevent concurrent token refresh requests.
   *
   * @param force - If true, the access token will be refreshed even if it is already cached.
   * @returns A promise that resolves to a valid access token.
   * @throws Error when unable to acquire the distributed lock.
   */
  async function getOrRefreshAccessToken(force = false): Promise<string> {
    const lock = await cache.tryAcquireLock(TRANSAK_ACCESS_TOKEN_LOCK_KEY, {
      ttlInMilliseconds: THIRTY_SECONDS_IN_MILLISECONDS,
      retryDelayInMilliseconds: RETRY_DELAY_IN_MILLISECONDS,
      retries: LOCK_RETRIES
    })

    // If the lock is not acquired, it means that another request is already refreshing the token
    if (!lock) {
      throw new Error('Failed to acquire lock')
    }

    try {
      const cachedAccessToken = await cache.get<string>(TRANSAK_ACCESS_TOKEN_CACHE_KEY)
      if (!cachedAccessToken || force) {
        const { accessToken, expiresAt } = await getAccessToken()
        const keyTTL = expiresAt - Date.now()
        await cache.set<string>(TRANSAK_ACCESS_TOKEN_CACHE_KEY, accessToken, fromMillisecondsToSeconds(keyTTL))
        logger.info(`Access token refreshed and cached for ${expiresAt - Date.now()} milliseconds`)
        return accessToken
      }

      return cachedAccessToken
    } catch (error) {
      logger.error(`Error getting or refreshing access token: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`)
      throw error
    } finally {
      await cache.tryReleaseLock(TRANSAK_ACCESS_TOKEN_LOCK_KEY)
    }
  }

  /**
   * Retrieves order information from the Transak API for a given order ID.
   * Returns relevant data related to status changes including order status and transaction hash.
   *
   * @param orderId - The unique Transak Order ID to retrieve information for.
   * @returns A promise that resolves to the order response data from Transak API.
   * @throws Error when the API request fails or returns a non-ok status.
   */
  async function getOrder(orderId: string): Promise<OrderResponse> {
    try {
      const accessToken = await getOrRefreshAccessToken()
      const res = await fetch.fetch(`${apiURL}/v2/order/${orderId}`, {
        method: 'GET',
        headers: { 'access-token': accessToken }
      })

      if (!res.ok) {
        throw new Error(`Error getting order, status: ${res.status}`)
      }

      return res.json()
    } catch (error) {
      logger.error(`Error getting order: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`)
      throw error
    }
  }

  async function getWidget(options?: WidgetOptions): Promise<string> {
    try {
      const accessToken = await getOrRefreshAccessToken()
      const res = await fetch.fetch(`${apiGatewayURL}/v2/auth/session`, {
        method: 'POST',
        headers: { 'access-token': accessToken, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          widgetParams: {
            apiKey,
            referrerDomain: marketplaceDomain,
            networks: 'ethereum,polygon',
            cryptoCurrencyCode: 'MANA',
            defaultCryptoCurrency: 'MANA',
            cyptoCurrencyList: 'MANA',
            ...options
          }
        })
      })

      const body: { data: { widgetUrl: string } } = await res.json()
      if (!res.ok) {
        throw new Error(`Error getting widget, status: ${res.status}`)
      }
      return body.data.widgetUrl
    } catch (error) {
      logger.error(`Error getting widget: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`)
      throw error
    }
  }

  /**
   * Obtains a new access token from the Transak API using the configured API credentials.
   * Makes a POST request to the refresh-token endpoint with the API key and secret.
   *
   * @returns A promise that resolves to an object containing the access token and its expiration timestamp.
   * @throws Error when the HTTP request fails or the API returns an error response.
   */
  async function getAccessToken(): Promise<{ accessToken: string; expiresAt: number }> {
    logger.info(`Getting access token from ${apiURL}/v2/refresh-token`)
    const res = await fetch.fetch(`${apiURL}/v2/refresh-token`, {
      method: 'POST',
      headers: { 'api-secret': apiSecret, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey })
    })

    if (!res.ok) {
      throw new Error(`Error refreshing access token, status: ${res.status}`)
    }

    const bodyRes: { data: { accessToken: string; expiresAt: number } } = await res.json()

    logger.info(`Access token received. Expires at ${bodyRes.data.expiresAt}`)

    return { accessToken: bodyRes.data.accessToken, expiresAt: bodyRes.data.expiresAt }
  }

  return {
    getOrRefreshAccessToken,
    getWidget,
    getOrder
  }
}
