import { AppComponents } from '../../types'
import { ITransakComponent, OrderResponse } from './types'

export function createTransakComponent(
  components: Pick<AppComponents, 'fetch'>,
  {
    apiURL,
    apiKey,
    apiSecret
  }: {
    apiURL: string
    apiKey: string
    apiSecret: string
  }
): ITransakComponent {
  const { fetch } = components
  let accessToken: string
  let accessTokenExpiresAt: number
  /**
   * Given the order id, returns relevant data related to status changes (status & tx hash).
   *
   * @param orderId - Transak Order ID.
   */
  async function getOrder(orderId: string): Promise<OrderResponse> {
    if (!accessToken || !accessTokenExpiresAt || Date.now() > accessTokenExpiresAt * 1000) {
      // accessTokenExpires at is in seconds
      accessToken = await refreshAccessToken()
    }

    const res = await fetch.fetch(`${apiURL}/v2/order/${orderId}`, {
      method: 'GET',
      headers: { 'access-token': accessToken }
    })
    return res.json()
  }

  /**
   * Returns a new access-token to fetch order data.
   *
   * @param orderId - Transak Order ID.
   */
  async function refreshAccessToken(): Promise<string> {
    try {
      const res = await fetch.fetch(`${apiURL}/v2/refresh-token`, {
        method: 'POST',
        headers: { 'api-secret': apiSecret, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey })
      })

      if (!res.ok) {
        throw new Error(`HTTP error! Status: ${res.status}`)
      }

      const bodyRes: { data: { accessToken: string; expiresAt: number } } = await res.json()
      console.log('bodyRes: ', bodyRes)

      accessTokenExpiresAt = bodyRes.data.expiresAt
      return bodyRes.data.accessToken
    } catch (error) {
      console.error('Error refreshing access token:', error)
      // You can rethrow the error or return a fallback value if necessary
      throw error
    }
  }

  return {
    getOrder
  }
}
