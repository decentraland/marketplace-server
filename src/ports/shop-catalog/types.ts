// The Shop's curated read model: only credit-buyable (USD-pegged) offchain listings, unified across
// primary (public_item_order) and secondary (public_nft_order), with the tradeId included so the
// client can buy/cancel without a second lookup. Lighter than /v2/catalog (no owners/picks/etc.).

// Pagination bounds, shared by the handler (parses the request) and the component (clamps defensively).
export const SHOP_DEFAULT_PAGE_SIZE = 48
export const SHOP_MIN_PAGE_SIZE = 1
export const SHOP_MAX_PAGE_SIZE = 1000

export type ShopListingType = 'primary' | 'secondary'

export type ShopListing = {
  tradeId: string
  listingType: ShopListingType
  contractAddress: string
  itemId: string | null // primary (mint) listings
  tokenId: string | null // secondary (resale) listings
  name: string
  thumbnail: string
  rarity: string
  category: string // top-level: 'wearable' | 'emote'
  wearableCategory: string | null // on-chain category (upper_body, hat, ...) when applicable
  creator: string
  priceCredits: number // USD -> fixed credits (1 credit = $0.10)
  available: number
  network: string
  chainId: number
  createdAt: number
}

export type ShopSortBy = 'newest' | 'cheapest' | 'most_expensive' | 'name'

export type ShopCatalogFilters = {
  first?: number
  skip?: number
  category?: string // 'wearable' | 'emote'
  contractAddress?: string
  itemId?: string
  rarities?: string[]
  wearableCategories?: string[] // on-chain categories (upper_body, hat, ...)
  minPriceCredits?: number
  maxPriceCredits?: number
  search?: string
  sortBy?: ShopSortBy
}

// A seller's OLD classic (ERC20-MANA) listing that can be re-listed into the Shop as credit-buyable.
// Carries the raw MANA price (client converts to credits via the oracle) + the old trade id.
export type ImportableListing = {
  oldTradeId: string
  listingType: ShopListingType
  contractAddress: string
  itemId: string | null
  tokenId: string | null
  name: string
  thumbnail: string
  rarity: string
  category: string
  wearableCategory: string | null
  manaWei: string
  available: number
  network: string
  chainId: number
}

export interface IShopCatalogComponent {
  getShopListings(filters: ShopCatalogFilters): Promise<{ data: ShopListing[]; total: number }>
  getImportableListings(seller: string): Promise<ImportableListing[]>
}

export type ImportableListingRow = {
  old_trade_id: string
  trade_type: string
  contract_address: string
  item_id: string | null
  token_id: string | null
  name: string | null
  image: string | null
  rarity: string | null
  item_type: string | null
  wearable_category: string | null
  mana_wei: string
  available: string | null
  network: string | null
}

// Raw DB row (before mapping to ShopListing).
export type ShopListingRow = {
  trade_id: string
  trade_type: string
  contract_address: string
  item_id: string | null
  token_id: string | null
  name: string | null
  image: string | null
  rarity: string | null
  item_type: string | null
  wearable_category: string | null
  creator: string | null
  price: string
  available: string | null
  network: string | null
  created_at: string
  total: string
}
