// The Shop's curated read model: only credit-buyable (USD-pegged) offchain listings, unified across
// primary (public_item_order) and secondary (public_nft_order), with the tradeId included so the
// client can buy/cancel without a second lookup. Lighter than /v2/catalog (no owners/picks/etc.).

// Pagination bounds, shared by the handler (parses the request) and the component (clamps defensively).
export const SHOP_DEFAULT_PAGE_SIZE = 48
export const SHOP_MIN_PAGE_SIZE = 1
export const SHOP_MAX_PAGE_SIZE = 1000

// Bounds for the related-items rail. Kept separate from (and far below) the browse page size: this is a
// single carousel, so a caller asking for hundreds would only widen a scan nothing can render.
export const RELATED_DEFAULT_LIMIT = 10
export const RELATED_MAX_LIMIT = 50

// Bounds for the trending rail. Same reasoning as the related-items caps: one carousel, so a caller asking
// for hundreds would only widen a scan nothing can render.
export const TRENDING_DEFAULT_LIMIT = 12
export const TRENDING_MAX_LIMIT = 50

/**
 * The look-back window, in days, over which sales are counted. 1 = "since midnight yesterday", the SAME
 * window the marketplace's own trending row uses (both resolve it through `getDateXDaysAgo`), so the two
 * rows are computed over the same slice of history.
 *
 * Capped at a week: the window is a full scan of `sale` above a timestamp, and a year-long request would be
 * a cheap way to make an expensive query.
 */
export const TRENDING_DEFAULT_DAYS = 1
export const TRENDING_MIN_DAYS = 1
export const TRENDING_MAX_DAYS = 7

/**
 * How the rail's slots are split between the two ranking signals, matching the marketplace's own row: 60%
 * of the slots go to the items with the MOST SALES, the remaining 40% to the biggest TRADED VOLUME among
 * whatever the first pass did not already take.
 *
 * Both signals are kept because either alone is misleading: sales count alone lets a 1-credit item that sold
 * 50 times bury a 200-credit item that sold 10, and volume alone is dominated by a single expensive sale.
 */
export const TRENDING_SALES_CUT = 0.6

export type ShopListingType = 'primary' | 'secondary'

// Display gender, derived from a wearable's supported body shapes (BaseMale/BaseFemale). `null` for
// emotes or items with no body-shape metadata.
export type ShopGender = 'male' | 'female' | 'unisex' | null

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
  gender: ShopGender // male | female | unisex (from body shapes); null for emotes/unknown
  creator: string
  seller: string | null // secondary (resale): the reseller = current owner of the sent NFT; null for primary
  issuedId: string | null // secondary (resale): the NFT mint index (issued id); null for primary
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
  creator?: string // item creator address — a creator's storefront (their credit-buyable listings)
  rarities?: string[]
  wearableCategories?: string[] // on-chain categories (upper_body, hat, ...)
  isSmart?: boolean // restrict to smart wearables (Shop "Smart" filter)
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

// A classic (ERC20-MANA) PRIMARY listing surfaced as a paginated browse feed so the Shop can offer
// the "old liquidity" for purchase with credits. Like ImportableListing it carries the raw MANA price
// (the client converts to credits via the oracle), but this is a public catalog feed, not per-seller.
// Primaries only: secondary-with-credits is disabled, so public_nft_order rows are excluded entirely.
export type LegacyListing = {
  tradeId: string
  listingType: 'primary'
  contractAddress: string
  itemId: string | null
  name: string
  thumbnail: string
  rarity: string
  category: string // top-level: 'wearable' | 'emote'
  wearableCategory: string | null // on-chain category (upper_body, hat, ...) when applicable
  gender: ShopGender // male | female | unisex (from body shapes); null for emotes/unknown
  creator: string
  manaWei: string // raw MANA price; the client converts to credits via the oracle
  available: number
  network: string
  chainId: number
  createdAt: number
}

// Filters accepted by getLegacyListings. Same shape as ShopCatalogFilters minus the price-range
// bounds, which would need a live MANA/credit rate on the server and are out of scope for v1.
export type LegacyCatalogFilters = {
  first?: number
  skip?: number
  category?: string // 'wearable' | 'emote'
  rarities?: string[]
  wearableCategories?: string[] // on-chain categories (upper_body, hat, ...)
  search?: string
  sortBy?: ShopSortBy
}

// Which liquidity pool a unified item comes from: 'native' = credit-buyable (USD-pegged) Shop listing,
// 'legacy' = classic MANA-priced primary converted to credits server-side via the live MANA/USD rate.
//
// This answers "how is it PRICED", nothing else. CollectionStore mints are 'legacy' — MANA-priced, live-rate
// converted — even though they are acquired completely differently; see UnifiedAcquisition.
export type UnifiedListingSource = 'native' | 'legacy'

/**
 * How the buyer acquires the item — a SEPARATE question from how it is priced.
 *
 * - 'trade': an offchain-marketplace signed order, bought with `accept([trade])`.
 * - 'store': a CollectionStore mint, bought with `CollectionStore.buy([{ collection, ids, prices,
 *   beneficiaries }])`. Not a listing at all: no order, no signature, and the supply is finite.
 *
 * These two facts used to coincide — everything MANA-priced was a legacy trade — so one enum covered both.
 * CollectionStore mints break the coincidence (MANA-priced AND not a trade), and collapsing them back into
 * `source` would silently change the meaning of every existing `source === 'legacy'` check, several of which
 * decide whether an item is priced from the live rate or rendered unbuyable.
 *
 * It also drives the buy path and the failure modes the client has to surface: a store buy re-validates the
 * price on-chain (so it can revert on a price move) and can sell out between browse and checkout.
 */
export type UnifiedAcquisition = 'trade' | 'store'

// A unified feed item: the same shape as a ShopListing (so the frontend consumes both uniformly) plus
// the source discriminator. Legacy items always carry a server-computed priceCredits, converted from
// their raw MANA price with the live rate and rounded UP to whole credits (same "Model B" as native).
export type UnifiedListing = Omit<ShopListing, 'tradeId'> & {
  /**
   * `null` for a CollectionStore mint, which has no trade — there is no order and nothing signed.
   *
   * Deliberately nullable rather than a synthetic id: this value is threaded into
   * `POST /credits/authorize` and persisted on the purchase intent, so a fabricated id would put a
   * reference to a nonexistent trade into the money ledger. Nullable makes the compiler point at every
   * caller that has to branch, instead of leaving it to be spotted in review.
   */
  tradeId: string | null
  source: UnifiedListingSource
  acquisition: UnifiedAcquisition
  // Raw MANA price (wei), present only for legacy items so the client can size the purchase at the live
  // rate at checkout. `null` for native (USD-pegged) items.
  manaWei: string | null
}

// Filters for the unified feed: the full ShopCatalogFilters (price-range works across BOTH sources now
// that the server has a MANA/USD rate) plus an optional source filter to restrict to one pool.
export type UnifiedCatalogFilters = ShopCatalogFilters & {
  source?: UnifiedListingSource
  /**
   * Restrict the feed to primary (mint) or secondary (resale) listings. Omitted = both, which is the
   * pre-existing behaviour.
   *
   * Exists so a client can hide resales WITHOUT filtering them out itself: the feed is paginated and
   * carries a total, so dropping rows client-side returns short pages and an overstated count.
   */
  listingType?: ShopListingType
  /**
   * Whether SOCIAL emotes (emotes carrying an outcome type) may appear. Omitted/true = included, which is
   * the pre-existing behaviour of this feed and the same default as /v1/items, /v2/catalog and
   * /v1/trendings — every one of those includes them unless `includeSocialEmotes=false` is sent explicitly.
   *
   * NOTE the CollectionStore branch excludes them unconditionally (see `storeBaseRelation`), so before this
   * filter existed the only way a social emote could reach the feed was through an offchain trade on one.
   * That is exactly the hole a client-side filter cannot close on a paginated feed, hence the server flag.
   */
  includeSocialEmotes?: boolean
}

// The ITEM-unified feed row: one entry per item (not per listing). Same shape as a UnifiedListing (the
// surviving representative listing -- primary if present, else cheapest credit-buyable secondary) plus a
// listingCount so the frontend can badge "N listings" / link to the PDP resale column. tradeId/listingType/
// tokenId/priceCredits/source all describe that representative (headline) listing.
export type UnifiedItem = UnifiedListing & {
  // How many open credit-buyable listings this item has (primary + secondary, native + legacy).
  listingCount: number
}

// Identifies the item a related-items query is anchored on. Only the item's identity travels over the
// wire: the similarity attributes (category/rarity) are resolved server-side so the rail is the same
// whatever the client happens to have hydrated.
export type RelatedItemsFilters = {
  contractAddress: string
  itemId: string
  first?: number
}

/**
 * Filters for the trending rail.
 *
 * Deliberately a NARROWED `UnifiedCatalogFilters`: the trending query wraps the shared item-unified core,
 * which is where `category`/`rarities`/`listingType`/`includeSocialEmotes`/... are applied, but the outer
 * layers that implement pagination, display sort and the credit price-range live in `getShopItems` and are
 * NOT part of this query. Omitting them from the type is what stops a caller passing `sortBy` or
 * `maxPriceCredits` and being silently ignored — the ranking IS the sort here, and a rail has no pages.
 */
export type TrendingItemsFilters = Omit<UnifiedCatalogFilters, 'skip' | 'sortBy' | 'minPriceCredits' | 'maxPriceCredits'> & {
  // Look-back window in days (clamped to [TRENDING_MIN_DAYS, TRENDING_MAX_DAYS]).
  days?: number
}

// A trending rail entry: the item-unified shape the browse grid and the related rail already render, plus
// the ranking signal that put it there. `trendingSales` is exposed so the ordering is verifiable from
// outside the server (and so a client could explain the row) — it is the sale COUNT inside the window, which
// includes resales and mints alike; see getTrendingItems on why the signal is broader than the row.
export type TrendingItem = UnifiedItem & {
  trendingSales: number
}

/** Look-back window and size for the shop's creator rail. */
/**
 * The smallest published catalogue a "top creator" can have.
 *
 * Ranking over a 30-day window means a month can be won on ONE lucky item: production had a creator third
 * on 33 sales of two items — real demand, 27 distinct buyers, simply a hit — whose whole catalogue was four
 * items. The row exists to send someone off to browse a creator, and four items is not something to browse.
 *
 * Taken off the production distribution rather than invented: the median candidate has 36 published items,
 * and of the thirty ranked only three fall under ten — at four, four and one. Nothing sits near the line.
 */
export const TOP_CREATORS_MIN_ITEMS = 10

export const TOP_CREATORS_DEFAULT_LIMIT = 30
export const TOP_CREATORS_MAX_LIMIT = 60
export const TOP_CREATORS_DEFAULT_DAYS = 30
export const TOP_CREATORS_MIN_DAYS = 1
export const TOP_CREATORS_MAX_DAYS = 365

export type TopCreatorsFilters = {
  first?: number
  days?: number
}

/**
 * A creator ranked by how much of THEIR catalogue sold in the window.
 *
 * Deliberately not `/v1/rankings/creators`, which reads the squid's per-account day data and so counts
 * only sales where the creator's own address was the seller. A primary mint is executed by the buyer
 * against the store, so it never lands there — and for a shop whose creators sell mostly primary, that
 * undercounts them severalfold (measured: 14 vs 35 over the same 30 days for the same creator). This
 * attributes a sale to whoever CREATED the item, which is the question the rail is actually asking.
 *
 * `sales` counts mints and resales alike: both are that creator's work changing hands.
 */
export type TopCreator = {
  id: string // creator wallet address
  /** Sales in the requested window. What the ranking is ORDERED by. */
  sales: number
  /** Sales over all time. What the row DISPLAYS — a creator's standing, not their last month. */
  totalSales: number
  /** Approved collections they have published. */
  collections: number
  /** Approved items across those collections. */
  items: number
}

export type TopCreatorRow = {
  creator: string
  sales: number
  total_sales: number
  collections: number
  items: number
}

// The anchor item's similarity attributes, resolved from the squid `item` row.
export type ReferenceItem = {
  category: string // top-level: 'wearable' | 'emote'
  wearableCategory: string | null // on-chain category (upper_body, hat, ...) when applicable
  rarity: string | null
}

export interface IShopCatalogComponent {
  getShopListings(filters: ShopCatalogFilters): Promise<{ data: ShopListing[]; total: number }>
  getImportableListings(seller: string): Promise<ImportableListing[]>
  getLegacyListings(filters: LegacyCatalogFilters): Promise<{ data: LegacyListing[]; total: number }>
  // Merges native (USD-pegged) and legacy (classic MANA) listings into ONE credit-priced feed. The
  // caller supplies the current MANA/USD rate (USD per MANA) used to convert legacy prices to credits
  // and to make the price-range filter + sort comparable across both sources.
  getUnifiedListings(filters: UnifiedCatalogFilters, manaUsdRate: number): Promise<{ data: UnifiedListing[]; total: number }>
  // Same credit-buyable universe and filters as getUnifiedListings, but UNIFIED BY ITEM: one row per
  // (contract, item), priced primary-if-present else cheapest credit-buyable secondary, carrying a
  // per-item listingCount. This is the shop BROWSE feed; getUnifiedListings stays per-listing (PDP resale).
  getShopItems(filters: UnifiedCatalogFilters, manaUsdRate: number): Promise<{ data: UnifiedItem[]; total: number }>
  // Items SIMILAR to one item, drawn from the same credit-buyable, item-unified universe as getShopItems
  // so the client can render them with the very same card. Same top-level + on-chain category is the hard
  // filter; rarity only steers the ORDER (closest tier first). Excludes the anchor item. Unpaginated --
  // it backs a single carousel, so there is no total to report.
  getRelatedItems(filters: RelatedItemsFilters, manaUsdRate: number): Promise<{ data: UnifiedItem[] }>
  // The TRENDING rail: the items that sold most in the look-back window, restricted to the same
  // credit-buyable, item-unified universe as getShopItems so every card is one the Shop can actually sell.
  // Unpaginated (a single carousel) and ordered BY the ranking, so there is no total and no caller sort.
  getTrendingItems(filters: TrendingItemsFilters, manaUsdRate: number): Promise<{ data: TrendingItem[] }>
  getTopCreators(filters: TopCreatorsFilters): Promise<{ data: TopCreator[] }>
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
  gender: ShopGender
  creator: string | null
  seller: string | null // secondary: sent NFT owner (from mv.assets->'sent'->>'owner'); null for primary
  issued_id: string | null // secondary: sent NFT issued id (from mv.assets->'sent'->>'issued_id'); null for primary
  price: string
  available: string | null
  network: string | null
  created_at: string
  total: string
}

// Raw DB row for the unified feed (native + legacy), before mapping to UnifiedListing. priceCredits is
// computed in SQL (CEIL of the USD-wei-equivalent) so the merged feed is sorted/paginated as one set.
export type UnifiedListingRow = {
  source: UnifiedListingSource
  acquisition: UnifiedAcquisition
  // NULL on a store row (no trade). The SQL still carries the item id in this column for the DISTINCT ON
  // tiebreaker; the mapper is what drops it, so nothing downstream can mistake it for a trade.
  trade_id: string | null
  trade_type: string
  contract_address: string
  item_id: string | null
  token_id: string | null
  name: string | null
  image: string | null
  rarity: string | null
  item_type: string | null
  wearable_category: string | null
  gender: ShopGender
  creator: string | null
  seller: string | null // secondary: sent NFT owner (from mv.assets->'sent'->>'owner'); null for primary
  issued_id: string | null // secondary: sent NFT issued id (from mv.assets->'sent'->>'issued_id'); null for primary
  price_credits: string
  mana_wei: string | null
  available: string | null
  network: string | null
  created_at: string
  total: string
}

// Raw DB row for the item-unified feed, before mapping to UnifiedItem. Same columns as UnifiedListingRow
// (of the surviving representative listing) plus the per-item listing_count.
export type UnifiedItemRow = UnifiedListingRow & {
  listing_count: string
}

// The related-items rail selects the same columns minus `total`: it is unpaginated, so there is no
// COUNT(*) OVER() to carry.
export type RelatedItemRow = Omit<UnifiedItemRow, 'total'>

// Raw DB row for the trending rail: the unpaginated item-unified columns plus the ranking signals. `volume`
// is a numeric SUM of MANA wei so it comes back as a string; it only ever feeds the ORDER BY, and is not
// mapped into the response.
export type TrendingItemRow = RelatedItemRow & {
  sales: number
  volume: string
}

// Raw DB row for the anchor-item lookup that a related-items query starts from.
export type ReferenceItemRow = {
  rarity: string | null
  item_type: string | null
  wearable_category: string | null
}

// Raw DB row for the legacy (classic MANA) primary feed, before mapping to LegacyListing.
export type LegacyListingRow = {
  trade_id: string
  contract_address: string
  item_id: string | null
  name: string | null
  image: string | null
  rarity: string | null
  item_type: string | null
  wearable_category: string | null
  gender: ShopGender
  creator: string | null
  mana_wei: string
  available: string | null
  network: string | null
  created_at: string
  total: string
}
