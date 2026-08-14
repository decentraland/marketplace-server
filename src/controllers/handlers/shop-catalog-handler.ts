import { IHttpServerComponent } from '@dcl/core-commons'
import { GenderFilterOption } from '@dcl/schemas'
import { Params } from '../../logic/http/params'
import { asJSON } from '../../logic/http/response'
import {
  ShopListingType,
  ShopSortBy,
  UnifiedListingSource,
  RELATED_DEFAULT_LIMIT,
  SHOP_DEFAULT_PAGE_SIZE,
  SHOP_MAX_PAGE_SIZE,
  TOP_CREATORS_DEFAULT_DAYS,
  TOP_CREATORS_DEFAULT_LIMIT,
  TRENDING_DEFAULT_DAYS,
  TRENDING_DEFAULT_LIMIT
} from '../../ports/shop-catalog/types'
import { AppComponents, Context } from '../../types'
import { getItemsParams } from './utils'

// Valid sort values, as a map so Params.getValue can validate the query param against them (mirrors
// how the catalog handler validates CatalogSortBy) and return undefined for anything unexpected.
const SORT_VALUES: Record<ShopSortBy, ShopSortBy> = {
  newest: 'newest',
  cheapest: 'cheapest',
  most_expensive: 'most_expensive',
  name: 'name'
}

// Valid `source` values for the unified feed (validated the same way as sortBy).
const SOURCE_VALUES: Record<UnifiedListingSource, UnifiedListingSource> = {
  native: 'native',
  legacy: 'legacy'
}

// Valid `listingType` values for the unified feed. Omitted = both.
const LISTING_TYPE_VALUES: Record<ShopListingType, ShopListingType> = {
  primary: 'primary',
  secondary: 'secondary'
}

// Valid `groupBy` values for the unified feed. 'listing' (default) -> one row per open trade (the PDP
// resale view needs this). 'item' -> one row per item, priced primary-if-present else cheapest
// credit-buyable secondary, with a per-item listingCount (the shop BROWSE feed).
type UnifiedGroupBy = 'listing' | 'item'
const GROUP_BY_VALUES: Record<UnifiedGroupBy, UnifiedGroupBy> = {
  listing: 'listing',
  item: 'item'
}

function csv(value?: string): string[] | undefined {
  const parts = value
    ?.split(',')
    .map(v => v.trim())
    .filter(Boolean)
  return parts && parts.length ? parts : undefined
}

// `wearableGender`, in either encoding a caller might reasonably reach for: this feed's
// comma-separated lists (what `rarity` and `wearableCategory` take) or the repeated
// `&wearableGender=male&wearableGender=female` form /v1/items takes, which is where the param and its
// values come from. Anything outside GenderFilterOption is dropped, so a typo leaves the feed
// unfiltered instead of asking for a body shape no item declares.
function genderList(params: Params): GenderFilterOption[] | undefined {
  const valid = Object.values(GenderFilterOption) as string[]
  const requested = new Set([...(csv(params.getString('wearableGender')) ?? []), ...params.getList('wearableGender')])
  const genders = [...requested].filter((value): value is GenderFilterOption => valid.includes(value))
  return genders.length ? genders : undefined
}

// GET /v3/catalog/shop -- curated feed of credit-buyable (USD-pegged) listings for the Shop.
export function createShopCatalogHandler(
  components: Pick<AppComponents, 'shopCatalog'>
): IHttpServerComponent.IRequestHandler<Context<'/v3/catalog/shop'>> {
  const { shopCatalog } = components

  return async context => {
    const params = new Params(context.url.searchParams)
    const first = Math.min(params.getNumber('first', SHOP_DEFAULT_PAGE_SIZE) ?? SHOP_DEFAULT_PAGE_SIZE, SHOP_MAX_PAGE_SIZE)
    const skip = params.getNumber('skip', 0) ?? 0
    const category = params.getString('category')
    const contractAddress = params.getString('contractAddress')
    const itemId = params.getString('itemId')
    const creator = params.getString('creator')
    const rarities = csv(params.getString('rarity'))
    const wearableCategories = csv(params.getString('wearableCategory'))
    const isSmart = params.getBoolean('isSmart')
    const minPriceCredits = params.getNumber('minPriceCredits')
    const maxPriceCredits = params.getNumber('maxPriceCredits')
    const search = params.getString('search')
    const sortBy = params.getValue<ShopSortBy>('sortBy', SORT_VALUES)

    return asJSON(async () => {
      const { data, total } = await shopCatalog.getShopListings({
        first,
        skip,
        category,
        contractAddress,
        itemId,
        creator,
        rarities,
        wearableCategories,
        isSmart,
        minPriceCredits,
        maxPriceCredits,
        search,
        sortBy
      })
      return { data, total }
    })
  }
}

// GET /v3/catalog/legacy -- paginated feed of classic MANA-priced PRIMARY listings (the "old
// liquidity") so the Shop can offer them for purchase with credits. Returns the raw MANA price
// (manaWei); the client converts to credits via the oracle. No price-range filter in v1.
export function createShopLegacyHandler(
  components: Pick<AppComponents, 'shopCatalog'>
): IHttpServerComponent.IRequestHandler<Context<'/v3/catalog/legacy'>> {
  const { shopCatalog } = components

  return async context => {
    const params = new Params(context.url.searchParams)
    const first = Math.min(params.getNumber('first', SHOP_DEFAULT_PAGE_SIZE) ?? SHOP_DEFAULT_PAGE_SIZE, SHOP_MAX_PAGE_SIZE)
    const skip = params.getNumber('skip', 0) ?? 0
    const category = params.getString('category')
    const rarities = csv(params.getString('rarity'))
    const wearableCategories = csv(params.getString('wearableCategory'))
    const search = params.getString('search')
    const sortBy = params.getValue<ShopSortBy>('sortBy', SORT_VALUES)

    return asJSON(async () => {
      const { data, total } = await shopCatalog.getLegacyListings({
        first,
        skip,
        category,
        rarities,
        wearableCategories,
        search,
        sortBy
      })
      return { data, total }
    })
  }
}

// GET /v3/catalog/unified -- the UNIFIED shop feed: native (USD-pegged) + legacy (classic MANA)
// listings in ONE credit-priced feed. Every item carries a server-computed priceCredits (legacy
// converted MANA->credits with the live rate) and a `source` discriminator. Same query params as
// /v3/catalog/shop plus optional `source` (native|legacy). Sorting and minPriceCredits/maxPriceCredits
// work across BOTH sources.
//
// `groupBy=item` collapses the feed to ONE row per item (priced primary-if-present else cheapest
// credit-buyable secondary, plus a per-item listingCount) -- the shop BROWSE feed. The default
// (`groupBy=listing`) keeps one row per open trade, which the PDP resale view depends on.
export function createShopUnifiedHandler(
  components: Pick<AppComponents, 'shopCatalog' | 'manaUsdRate'>
): IHttpServerComponent.IRequestHandler<Context<'/v3/catalog/unified'>> {
  const { shopCatalog, manaUsdRate } = components

  return async context => {
    const params = new Params(context.url.searchParams)
    const first = Math.min(params.getNumber('first', SHOP_DEFAULT_PAGE_SIZE) ?? SHOP_DEFAULT_PAGE_SIZE, SHOP_MAX_PAGE_SIZE)
    const skip = params.getNumber('skip', 0) ?? 0
    const category = params.getString('category')
    const contractAddress = params.getString('contractAddress')
    const itemId = params.getString('itemId')
    const creator = params.getString('creator')
    const rarities = csv(params.getString('rarity'))
    const wearableCategories = csv(params.getString('wearableCategory'))
    const isSmart = params.getBoolean('isSmart')
    const wearableGenders = genderList(params)
    const minPriceCredits = params.getNumber('minPriceCredits')
    const maxPriceCredits = params.getNumber('maxPriceCredits')
    const search = params.getString('search')
    const sortBy = params.getValue<ShopSortBy>('sortBy', SORT_VALUES)
    const source = params.getValue<UnifiedListingSource>('source', SOURCE_VALUES)
    // Omitted = both, which is the pre-existing behaviour. `getValue` rejects anything outside the set,
    // so a typo is a 400 rather than a silently unfiltered feed — the failure mode that matters here,
    // since a caller asking for `primary` and getting everything would show resales it meant to hide.
    const listingType = params.getValue<ShopListingType>('listingType', LISTING_TYPE_VALUES)
    const groupBy = params.getValue<UnifiedGroupBy>('groupBy', GROUP_BY_VALUES, 'listing')
    // Same contract as every other feed: included unless `includeSocialEmotes=false` is sent, so the default
    // is byte-for-byte the pre-existing response. Read as a string rather than through the presence-based
    // `getBoolean`, which would read `includeSocialEmotes=false` as `true`.
    const includeSocialEmotes = params.getString('includeSocialEmotes') !== 'false'

    const filters = {
      first,
      skip,
      category,
      contractAddress,
      itemId,
      creator,
      rarities,
      wearableCategories,
      isSmart,
      wearableGenders,
      minPriceCredits,
      maxPriceCredits,
      search,
      sortBy,
      source,
      listingType,
      includeSocialEmotes
    }

    return asJSON(async () => {
      const rate = manaUsdRate.getRate()
      const { data, total } =
        groupBy === 'item' ? await shopCatalog.getShopItems(filters, rate) : await shopCatalog.getUnifiedListings(filters, rate)
      return { data, total }
    })
  }
}

// GET /v3/catalog/related?contractAddress=0x...&itemId=3&first=10 -- items SIMILAR to one item, backing
// the PDP's fallback rail for when the item's own collection has nothing else to show. Rows have the same
// shape as /v3/catalog/unified?groupBy=item (item-unified, credit-priced) so the client renders them with
// the same card. Unpaginated: returns { data } only. An unknown/missing item yields an empty rail rather
// than an error -- a recommendation nobody can make is not a client mistake.
export function createShopRelatedHandler(
  components: Pick<AppComponents, 'shopCatalog' | 'manaUsdRate'>
): IHttpServerComponent.IRequestHandler<Context<'/v3/catalog/related'>> {
  const { shopCatalog, manaUsdRate } = components

  return async context => {
    const params = new Params(context.url.searchParams)
    const contractAddress = params.getAddress('contractAddress')
    const itemId = params.getString('itemId')
    const first = params.getNumber('first', RELATED_DEFAULT_LIMIT) ?? RELATED_DEFAULT_LIMIT

    return asJSON(async () => {
      // `itemId` is validated here, not just checked for presence, because the query casts it:
      // `item.blockchain_id = ${itemId}::numeric`. A non-numeric value reaches Postgres, which raises
      // `invalid input syntax for type numeric`, and asJSON turns that into a 500 — so `?itemId=abc`
      // answered with a server error instead of the empty rail this endpoint promises for anything it
      // cannot resolve. `Params.getAddress` already gives `contractAddress` that guarantee; this gives it
      // to the other half.
      //
      // It is reachable from a bad URL rather than only from a hand-written request: the Shop reads the id
      // straight out of `/item/:contractAddress/:itemId`, so a malformed deep link would 500 the rail.
      // Blockchain ids are non-negative integers, so a digit check is the whole constraint.
      if (!contractAddress || !itemId || !/^\d+$/.test(itemId)) return { data: [] }
      return shopCatalog.getRelatedItems({ contractAddress, itemId, first }, manaUsdRate.getRate())
    })
  }
}

/**
 * GET /v3/catalog/trending?first=12&listingType=primary&includeSocialEmotes=false&days=1 -- the items
 * SELLING most right now, drawn from the same credit-buyable, item-unified universe as
 * /v3/catalog/unified?groupBy=item so the client renders them with the same card at the same credit price.
 *
 * Why not /v1/trendings: that endpoint answers "what is trending" in the marketplace's own terms -- MANA
 * prices, no credit price, no acquisition path (a store mint and a signed trade are indistinguishable), and
 * an `isOnSale` item may have no credit-buyable listing at all. It also returns its ranking SHUFFLED, so the
 * order carries no information. See getTrendingItems for what this computes instead.
 *
 * Unpaginated: returns { data } only. Cached for an hour, the same as /v1/trendings -- the window only moves
 * at midnight and the query is a scan of `sale`, so a per-visitor recomputation buys nothing.
 */
export function createShopTrendingHandler(
  components: Pick<AppComponents, 'shopCatalog' | 'manaUsdRate'>
): IHttpServerComponent.IRequestHandler<Context<'/v3/catalog/trending'>> {
  const { shopCatalog, manaUsdRate } = components

  return async context => {
    const params = new Params(context.url.searchParams)
    const first = params.getNumber('first', TRENDING_DEFAULT_LIMIT) ?? TRENDING_DEFAULT_LIMIT
    const days = params.getNumber('days', TRENDING_DEFAULT_DAYS) ?? TRENDING_DEFAULT_DAYS
    const category = params.getString('category')
    const rarities = csv(params.getString('rarity'))
    const wearableCategories = csv(params.getString('wearableCategory'))
    const listingType = params.getValue<ShopListingType>('listingType', LISTING_TYPE_VALUES)
    const source = params.getValue<UnifiedListingSource>('source', SOURCE_VALUES)
    // Included by default, excluded only on an explicit `includeSocialEmotes=false` -- the same contract as
    // /v1/items, /v2/catalog and /v1/trendings. Read as a string rather than through `getBoolean`, which is
    // presence-based and would read `includeSocialEmotes=false` as `true`.
    const includeSocialEmotes = params.getString('includeSocialEmotes') !== 'false'

    return asJSON(
      async () =>
        shopCatalog.getTrendingItems(
          { first, days, category, rarities, wearableCategories, listingType, source, includeSocialEmotes },
          manaUsdRate.getRate()
        ),
      { 'Cache-Control': 'public,max-age=3600,s-maxage=3600' }
    )
  }
}

// GET /v3/catalog/items -- the credit-aware CATALOG-ITEMS feed. Same data source and full-catalog
// semantics as GET /v1/items (ALL items incl. not-on-sale, keyed by item, filterable by creator,
// contractAddress, category, rarity, search, ...) but every item carries a server-computed,
// asset-type-aware priceCredits (USD-pegged items pass through; MANA-priced ones are converted with the
// live MANA/USD rate). Returns { data, total } where each item is the /v1/items shape plus priceCredits.
//
// On top of the /v1/items params it accepts `sortBy` and a CREDIT-denominated price range
// (minPriceCredits/maxPriceCredits) -- the Shop's own unit, unlike the MANA-wei minPrice/maxPrice. Both
// are parsed here rather than in the shared getItemsParams so /v1/items keeps its current behaviour.
export function createCatalogItemsHandler(
  components: Pick<AppComponents, 'items' | 'manaUsdRate'>
): IHttpServerComponent.IRequestHandler<Context<'/v3/catalog/items'>> {
  const { items, manaUsdRate } = components

  return async context => {
    const params = new Params(context.url.searchParams)
    const filters = {
      ...getItemsParams(params),
      minPriceCredits: params.getNumber('minPriceCredits'),
      maxPriceCredits: params.getNumber('maxPriceCredits'),
      sortBy: params.getValue<ShopSortBy>('sortBy', SORT_VALUES)
    }

    return asJSON(async () => {
      const rate = manaUsdRate.getRate()
      const { data, total } = await items.getCatalogItems(filters, rate)
      return { data, total }
    })
  }
}

// GET /v3/catalog/importable?seller=0x... -- a seller's OLD classic (MANA-priced) listings they can
// import into the Shop. Public read (open orders are already public).
export function createShopImportableHandler(
  components: Pick<AppComponents, 'shopCatalog'>
): IHttpServerComponent.IRequestHandler<Context<'/v3/catalog/importable'>> {
  const { shopCatalog } = components

  return async context => {
    const seller = new Params(context.url.searchParams).getAddress('seller')
    return asJSON(async () => {
      if (!seller) return { data: [] }
      return { data: await shopCatalog.getImportableListings(seller) }
    })
  }
}

/**
 * The shop's creator rail: who has sold the most of their own catalogue lately.
 *
 * Separate from `/v1/rankings/creators` on purpose — that one attributes a sale to the seller, so a
 * primary mint (executed by the buyer against the store) never reaches the creator's tally. See
 * TopCreator in the shop-catalog types for the measured gap.
 *
 * Cached for an hour like the other shop rails: the window is 30 days, so a fresher answer would change
 * nothing a visitor could notice.
 */
export function createShopTopCreatorsHandler(
  components: Pick<AppComponents, 'shopCatalog'>
): IHttpServerComponent.IRequestHandler<Context<'/v3/catalog/creators'>> {
  const { shopCatalog } = components

  return async context => {
    const params = new Params(context.url.searchParams)
    const first = params.getNumber('first', TOP_CREATORS_DEFAULT_LIMIT) ?? TOP_CREATORS_DEFAULT_LIMIT
    const days = params.getNumber('days', TOP_CREATORS_DEFAULT_DAYS) ?? TOP_CREATORS_DEFAULT_DAYS

    return asJSON(async () => shopCatalog.getTopCreators({ first, days }), {
      'Cache-Control': 'public,max-age=3600,s-maxage=3600'
    })
  }
}
