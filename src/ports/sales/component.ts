import { SaleFilters } from '@dcl/schemas'
import { fromDBSaleToSale } from '../../adapters/sales'
import { AppComponents } from '../../types'
import { getCreatorRoyaltiesQuery, getSalesQuery, getSalesSummaryQuery } from './queries'
import {
  CreatorRoyaltiesFilters,
  CreatorRoyaltiesPage,
  DBCreatorRoyalty,
  DBSale,
  ISalesComponent,
  SalesSummary,
  SalesSummaryFilters
} from './types'

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

  async function getRoyalties(filters: CreatorRoyaltiesFilters): Promise<CreatorRoyaltiesPage> {
    const result = await database.query<DBCreatorRoyalty>(getCreatorRoyaltiesQuery(filters))
    // Always one row at least: the totals. A page with no resales on it carries them on a row with no resale.
    const first = result.rows[0]
    return {
      data: result.rows
        .filter(row => row.id !== null)
        .map(row => ({
          id: row.id,
          timestamp: Number(row.timestamp),
          contractAddress: row.contract_address,
          itemId: row.item_id,
          tokenId: row.token_id,
          priceWei: row.price,
          royaltyWei: row.royalty,
          collector: row.collector,
          buyer: row.buyer,
          seller: row.seller,
          network: row.network
        })),
      total: first ? Number(first.total) : 0,
      royaltiesWei: first ? first.royalties_total : '0'
    }
  }

  return { getSales, getSummary, getRoyalties }
}
