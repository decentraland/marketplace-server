import { AppComponents } from '../../types'
import { ITransakComponent, OrderResponse } from './types'

export function createTransak(
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
    if (!accessToken || Date.now() > Number(`${accessTokenExpiresAt}000`)) {
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
    const res = await fetch.fetch(`${apiURL}/v2/refresh-token`, {
      method: 'POST',
      headers: { 'api-secret': apiSecret, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        apiKey
      })
    })

    const bodyRes: { data: { accessToken: string; expiresAt: string } } = await res.json()

    return bodyRes.data.accessToken
  }

  return {
    getOrder
  }
}
