import { ListingStatus, NFTCategory, Order, OrderFilters } from '@dcl/schemas'
import { SquidNetwork } from '../../types'

// @dcl/schemas' Order plus whether the off-chain marketplace contract it targets is paused.
export type OrderWithPause = Order & { isPaused: boolean }

export type IOrdersComponent = {
  getOrders(filters?: OrderFilters): Promise<{ data: OrderWithPause[]; total: number }>
}

export type DBOrder = {
  id: string
  count: number
  marketplace_address: string
  category: NFTCategory
  nft_address: string
  token_id: string
  owner: string
  buyer: string
  price: string
  status: ListingStatus
  created_at: number
  expires_at: number
  updated_at: number
  nft_id: string
  network: SquidNetwork
  item_id: string
  issued_id: string
  trade_id: string
  paused: boolean
}
