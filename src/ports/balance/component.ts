import { CovalentClient, Chain } from '@covalenthq/client-sdk'
import { formatBalanceItem } from '../../logic/balance/utils'
import { HttpError } from '../../logic/http/response'
import { Balance, IBalanceComponent } from './types'

export function createBalanceComponent({ apiKey }: { apiKey: string }): IBalanceComponent {
  async function getAddressChainBalance(chain: string, userAddress: string): Promise<Balance[]> {
    const client = new CovalentClient(apiKey)
    const { data, error, error_message, error_code } = await client.BalanceService.getTokenBalancesForWalletAddress(
      chain as Chain,
      userAddress
    )
    if (error) {
      throw new HttpError(error_message, error_code)
    }

    return data.items.map(formatBalanceItem)
  }

  return {
    getAddressChainBalance
  }
}
