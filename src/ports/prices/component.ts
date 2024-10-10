import { AppComponents } from '../../types'
import { getPricesQuery } from './queries'
import { IPricesComponent, PriceFilters } from './types'

export function createPricesComponents(components: Pick<AppComponents, 'dappsDatabase'>): IPricesComponent {
  const { dappsDatabase: database } = components

  async function getPrices(filters: PriceFilters) {
    const prices = await database.query<any>(getPricesQuery(filters))
    console.log({ prices })
    return {
      meli: 1
    }
  }

  return { getPrices }
}
