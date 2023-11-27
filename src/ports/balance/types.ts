import { BalanceItem } from '@covalenthq/client-sdk'

export type IBalanceComponent = {
  getAddressChainBalance(chain: string, userAddress: string): Promise<Balance[]>
}

export type Balance = Omit<BalanceItem, 'balance' | 'balance_24h'> & {
  balance: string | null
  balance_24h: string | null
}
