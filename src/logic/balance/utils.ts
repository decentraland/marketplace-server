import { BalanceItem } from '@covalenthq/client-sdk'
import { Balance } from '../../ports/balance/types'

export const formatBalanceItem = ({ balance, balance_24h, ...rest }: BalanceItem): Balance => ({
  ...rest,
  balance: balance?.toString() || null,
  balance_24h: balance_24h?.toString() || null
})
