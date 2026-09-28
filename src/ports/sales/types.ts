import { Network, NFTCategory, Sale, SaleFilters, SaleType } from '@dcl/schemas'
import { SquidNetwork } from '../../types'

export interface ISalesComponent {
  getSummary(filters: SalesSummaryFilters): Promise<SalesSummary>
  getSales(filters: SaleFilters): Promise<GetSalesResponse>
  /**
   * A page of the resales of a creator's items with the royalty each paid.
   *
   * @param filters - The creator, an optional window in milliseconds, and the page.
   * @returns The page, the number of resales in the window and their royalty total.
   */
  getRoyalties(filters: CreatorRoyaltiesFilters): Promise<CreatorRoyaltiesPage>
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
  byCollection: { contractAddress: string; sold: number; earnedWei: string; earnedUsd: string; unpricedSales: number }[]
  byItem: { contractAddress: string; itemId: string; soldLifetime: number }[]
  /** `royaltiesWei` is what those resales actually paid in royalties, from each trade's royalty cut. */
  royalties: { resales: number; volumeWei: string; royaltiesWei: string }
}

export type CreatorRoyaltiesFilters = {
  creator: string
  from?: number
  to?: number
  first: number
  skip: number
}

/** One resale of a creator's item and the royalty it paid. Amounts are MANA wei as decimal strings. */
export type CreatorRoyalty = {
  id: string
  /** Milliseconds. */
  timestamp: number
  contractAddress: string
  itemId: string | null
  tokenId: string
  priceWei: string
  royaltyWei: string
  /** Who received the royalty: the item's beneficiary when one is set, else the creator. Null when not recorded. */
  collector: string | null
  buyer: string
  seller: string
  network: string
}

export type CreatorRoyaltiesPage = { data: CreatorRoyalty[]; total: number; royaltiesWei: string }

export type DBCreatorRoyalty = {
  id: string | null
  timestamp: string
  price: string
  royalty: string
  collector: string | null
  buyer: string
  seller: string
  contract_address: string
  item_id: string | null
  token_id: string
  network: string
  total: string
  royalties_total: string
}
