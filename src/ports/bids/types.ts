import { ChainId, Network, BidSortBy, Bid } from '@dcl/schemas'
import { PaginationParameters } from '../../logic/http'

export type IBidsComponent = {
  getBids(options: GetBidsParameters): Promise<{ data: Bid[]; count: number }>
}

// TODO: Add missing filters: seller, bidAddress, status
export type GetBidsParameters = PaginationParameters & {
  bidder?: string
  contractAddress?: string
  tokenId?: string
  itemId?: string
  sortBy?: BidSortBy
  network?: Network
}

type DBTradeBid = {
  trade_id: string
  bidder: string
  created_at: Date
  updated_at: Date
  expires_at: Date
  network: Network
  chain_id: ChainId
  price: string
  contract_address: string
  fingerprint?: string
} & ({ token_id: string; item_id: null } | { item_id: string; token_id: null })

export type DBBid = { count: number } & DBTradeBid // add legacy bids
