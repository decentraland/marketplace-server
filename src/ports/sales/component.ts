import { SaleFilters } from '@dcl/schemas'
import { fromDBSaleToSale } from '../../adapters/sales'
import { AppComponents } from '../../types'
import { extractCount } from '../pagination'
import { getSalesCountQuery, getSalesQuery } from './queries'
import { DBSale, ISalesComponent } from './types'

export function createSalesComponents(components: Pick<AppComponents, 'dappsDatabase'>): ISalesComponent {
  const { dappsDatabase: database } = components

  async function getSales(filters: SaleFilters) {
    const [sales, count] = await Promise.all([
      database.query<DBSale>(getSalesQuery(filters)),
      database.query<{ count: string }>(getSalesCountQuery(filters))
    ])
    return {
      data: sales.rows.map(fromDBSaleToSale),
      total: extractCount(count)
    }
  }

  return { getSales }
}
