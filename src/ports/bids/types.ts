import { ChainId, Network, Bid, ListingStatus, GetBidsParameters } from '@dcl/schemas'
import { SquidNetwork } from '../../types'

export type IBidsComponent = {
  getBids(options: GetBidsParameters): Promise<{ data: Bid[]; count: number }>
}

export type WithCount<T> = T & { count: number }

export type DBNetwork = SquidNetwork | Network.ETHEREUM | Network.MATIC

type DBBaseBid = {
  status?: ListingStatus
  bidder: string
  seller: string
  created_at: Date
  updated_at: Date
  expires_at: Date
  network: DBNetwork
  chain_id?: ChainId
  price: string
  contract_address: string
  fingerprint?: string
}

export type DBTradeBid = DBBaseBid & {
  trade_id: string
  legacy_bid_id: null // This is to correctly identify the type
} & ({ token_id: string; item_id: null } | { item_id: string; token_id: null })

export type DBLegacyBid = DBBaseBid & {
  legacy_bid_id: string
  bid_address: string
  blockchain_id: string
  block_number: string
  token_id: string
  trade_id: null // This is to correctly identify the type
}

export type DBBid = WithCount<DBTradeBid | DBLegacyBid>
