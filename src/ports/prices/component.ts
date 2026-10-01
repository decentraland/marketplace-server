import { AppComponents } from '../../types'
import { getPricesQuery } from './queries'
import { IPricesComponent, PriceFilters } from './types'
import { consolidatePrices } from './utils'

export function createPricesComponents(components: Pick<AppComponents, 'dappsDatabase' | 'contractStatus'>): IPricesComponent {
  const { dappsDatabase: database, contractStatus } = components

  async function getPrices(filters: PriceFilters) {
    const prices = await database.query<{ price: string }>(getPricesQuery(filters, contractStatus.getPausedContracts()))
    return consolidatePrices(prices.rows)
  }

  return { getPrices }
}
