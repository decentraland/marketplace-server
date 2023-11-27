import { CovalentClient, Chain } from '@covalenthq/client-sdk'
import { formatBalanceItem } from '../../logic/balance/utils'
import { Balance, IBalanceComponent } from './types'

export function createBalanceComponent({ apiKey }: { apiKey: string }): IBalanceComponent {
  async function getAddressChainBalance(chain: string, userAddress: string): Promise<Balance[]> {
    const client = new CovalentClient(apiKey)
    const {
      data: { items }
    } = await client.BalanceService.getTokenBalancesForWalletAddress(chain as Chain, userAddress)
    return items.map(formatBalanceItem)
  }

  return {
    getAddressChainBalance
  }
}
