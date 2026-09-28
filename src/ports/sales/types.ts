import { Network, NFTCategory, Sale, SaleFilters, SaleType } from '@dcl/schemas'
import { SquidNetwork } from '../../types'

export interface ISalesComponent {
  getSummary(filters: SalesSummaryFilters): Promise<SalesSummary>
  getSales(filters: SaleFilters): Promise<GetSalesResponse>
}

export type GetSalesResponse = {
  data: Sale[]
  total: number
}

export type DBSale = {
  sales_count: number
  id: string
  type: SaleType
  buyer: string
  seller: string
  item_id: string
  token_id: string
  contract_address: string
  price: string
  timestamp: string
  tx_hash: string
  network: SquidNetwork | Network.MATIC | Network.ETHEREUM
  category: NFTCategory
}

export type SalesSummaryFilters = {
  seller: string
  from?: number
  to?: number
}

export type SalesSummary = {
  total: number
  mints: number
  resales: number
  earnedWei: string
  /**
   * Earnings in USD at each sale's day rate, as a decimal string. Sales on a day with no stored rate (before
   * the feed started, or not yet backfilled) add nothing here and are counted in `unpricedSales`.
   */
  earnedUsd: string
  unpricedSales: number
  byCollection: { contractAddress: string; sold: number; earnedWei: string; earnedUsd: string }[]
  byItem: { contractAddress: string; itemId: string; soldLifetime: number }[]
  royalties: { resales: number; volumeWei: string }
}
