import { AppComponents } from '../../types'
import { getPricesQuery } from './queries'
import { IPricesComponent, PriceFilters } from './types'
import { consolidatePrices } from './utils'

export function createPricesComponents(components: Pick<AppComponents, 'dappsDatabase'>): IPricesComponent {
  const { dappsDatabase: database } = components

  async function getPrices(filters: PriceFilters) {
    const prices = await database.query<{ price: string }>(getPricesQuery(filters))
    return consolidatePrices(prices.rows)
  }

  return { getPrices }
}
