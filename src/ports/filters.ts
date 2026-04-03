import SQL, { SQLStatement } from 'sql-template-strings'
import { Network } from '@dcl/schemas'
import { getDBNetworks } from '../utils'

export function getNetworkFilter(network: Network | undefined, column = 'network'): SQLStatement | null {
  if (!network) return null
  return SQL``.append(column).append(SQL` = ANY (${getDBNetworks(network)})`)
}

export function getMinPriceFilter(minPrice: string | undefined, column = 'price'): SQLStatement | null {
  if (!minPrice) return null
  return SQL``.append(column).append(SQL` >= ${minPrice}`)
}

export function getMaxPriceFilter(maxPrice: string | undefined, column = 'price'): SQLStatement | null {
  if (!maxPrice) return null
  return SQL``.append(column).append(SQL` <= ${maxPrice}`)
}

export function getAddressFilter(address: string | undefined, column: string): SQLStatement | null {
  if (!address) return null
  return SQL``.append(column).append(SQL` = ${address.toLowerCase()}`)
}
