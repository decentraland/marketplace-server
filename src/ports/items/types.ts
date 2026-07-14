import { BodyShape, EmoteCategory, Item, ItemFilters, Network, Rarity, WearableCategory, EmoteOutcomeType } from '@dcl/schemas'
import { SquidNetwork } from '../../types'

export type ItemQueryFilters = ItemFilters & { includeSocialEmotes?: boolean }

export interface IItemsComponent {
  validateItemExists(itemId: string): Promise<void>
  getItems(filters?: ItemQueryFilters): Promise<GetItemsResponse>
  // The credit-aware catalog-items feed: same items as getItems (full catalog, incl. not-on-sale) but
  // each item carries a server-computed, asset-type-aware priceCredits. `manaUsdRate` is USD per MANA,
  // used to convert MANA-priced items (classic store minter / ERC20 trades) to credits; USD-pegged
  // items are already in USD and are NOT rate-adjusted.
  getCatalogItems(filters: ItemQueryFilters, manaUsdRate: number): Promise<GetCatalogItemsResponse>
}

export type GetItemsResponse = {
  data: Item[]
  total: number
}

// A catalog item is the same shape /v1/items returns plus a server-computed whole-credit price.
export type CatalogItem = Item & { priceCredits: number }

export type GetCatalogItemsResponse = {
  data: CatalogItem[]
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
  wearable_body_shapes?: BodyShape[]
  emote_body_shapes?: BodyShape[]
  description?: string
  isSmart?: boolean
  loop?: boolean
  has_sound?: boolean
  has_geometry?: boolean
  emote_outcome_type?: EmoteOutcomeType
  first_listed_at: Date
  network: Network.MATIC | Network.ETHEREUM | SquidNetwork
  search_is_store_minter: boolean
  search_is_marketplace_v3_minter: boolean
  trade_id?: string
  trade_beneficiary?: string
  trade_expires_at?: Date
  trade_contract?: string
  trade_price: string
  utility?: string
}

// A DBItem row from the catalog-items query: the same columns as DBItem plus the SQL-computed whole-credit
// price (CEIL of the USD-wei-equivalent). Nullable because the CASE yields 0 for not-for-sale items.
export type CatalogDBItem = DBItem & { price_credits: string | null }
