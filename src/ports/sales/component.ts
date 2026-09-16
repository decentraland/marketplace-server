import { SaleFilters } from '@dcl/schemas'
import { fromDBSaleToSale } from '../../adapters/sales'
import { AppComponents } from '../../types'
import { getSalesQuery, getSalesSummaryQuery } from './queries'
import { DBSale, ISalesComponent, SalesSummary, SalesSummaryFilters } from './types'

export function createSalesComponents(components: Pick<AppComponents, 'dappsDatabase'>): ISalesComponent {
  const { dappsDatabase: database } = components

  async function getSales(filters: SaleFilters) {
    const salesQuery = getSalesQuery(filters)
    const sales = await database.query<DBSale>(salesQuery)
    return {
      data: sales.rows.map(fromDBSaleToSale),
      total: sales.rowCount > 0 ? Number(sales.rows[0].sales_count) : 0
    }
  }

  async function getSummary(filters: SalesSummaryFilters): Promise<SalesSummary> {
    const result = await database.query<{ summary: SalesSummary }>(getSalesSummaryQuery(filters))
    return result.rows[0].summary
  }

  return { getSales, getSummary }
}
