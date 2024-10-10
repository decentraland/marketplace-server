import { SaleFilters } from '@dcl/schemas'
import { fromDBSaleToSale } from '../../adapters/sales'
import { AppComponents } from '../../types'
import { getSalesQuery } from './queries'
import { DBSale, ISalesComponent } from './types'

export function createSalesComponents(components: Pick<AppComponents, 'dappsDatabase'>): ISalesComponent {
  const { dappsDatabase: database } = components

  async function getSales(filters: SaleFilters) {
    console.log(getSalesQuery(filters).text)
    const sales = await database.query<DBSale>(getSalesQuery(filters))
    console.log(getSalesQuery(filters).text)
    return {
      data: sales.rows.map(fromDBSaleToSale),
      total: sales.rowCount > 0 ? Number(sales.rows[0].count) : 0
    }
  }

  return { getSales }
}
