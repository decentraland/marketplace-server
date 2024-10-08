import { BodyShape, EmoteCategory, Item, ItemFilters, Network, Rarity, WearableCategory } from '@dcl/schemas'
import { SquidNetwork } from '../../types'

export interface IItemsComponent {
  validateItemExists(itemId: string): Promise<void>
  getItems(filters?: ItemFilters): Promise<GetItemsResponse>
}

export type GetItemsResponse = {
  data: Item[]
  total: number
}

export enum ItemType {
  EMOTE_V1 = 'emote_v1',
  WEARABLE_V1 = 'wearable_v1',
  WEARABLE_V2 = 'wearable_v2',
  SMART_WEARABLE_V1 = 'smart_wearable_v1'
}

export type DBItem = {
  count: number
  id: string
  image: string
  uri: string
  item_type: ItemType
  wearable_category?: WearableCategory
  emote_category?: EmoteCategory
  item_id: string
  contract_address: string
  rarity: Rarity
  price: string
  available: number
  creator: string
  beneficiary: string
  created_at: number
  updated_at: number
  reviewed_at: number
  sold_at: number
  urn: string
  name: string
  body_shapes: BodyShape[]
  description?: string
  isSmart?: boolean
  loop?: boolean
  has_sound?: boolean
  has_geometry?: boolean
  first_listed_at: Date
  network: Network.MATIC | Network.ETHEREUM | SquidNetwork
  search_is_store_item: boolean
  trade_id?: string
  trade_beneficiary?: string
  trade_expires_at?: Date
  trade_price: string
  utility?: string
}
