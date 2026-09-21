import { IHttpServerComponent } from '@dcl/core-commons'
import { GenderFilterOption } from '@dcl/schemas'
import { isAddress } from '../../logic/address'
import { Params } from '../../logic/http/params'
import { asJSON } from '../../logic/http/response'
import { SUGGESTED_DEFAULT_LIMIT } from '../../logic/suggestions/constants'
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
import { AppComponents, AuthenticatedContext, Context } from '../../types'
import { getItemsParams } from './utils'

// Valid sort values, as a map so Params.getValue can validate the query param against them (mirrors
// how the catalog handler validates CatalogSortBy) and return undefined for anything unexpected.
const SORT_VALUES: Record<ShopSortBy, ShopSortBy> = {
  newest: 'newest',
  cheapest: 'cheapest',
  most_expensive: 'most_expensive',
  name: 'name',
  discount: 'discount',
  relevance: 'relevance'
}

// `discounted=true` keeps only listings a creator coupon discounts right now, `discounted=false` only the rest.
// Anything else leaves the feed unfiltered; read as a string because a presence check would read `false` as true.
// NOT `onSale`: the Shop already sends that to mean "listed", and the server has to keep ignoring it.
function discountedParam(params: Params): boolean | undefined {
  const value = params.getString('discounted')
  return value === 'true' ? true : value === 'false' ? false : undefined
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

/**
 * The collections the unified feed is restricted to, or `undefined` when the caller named none.
 *
 * Takes either encoding a caller might reasonably reach for, the same way `genderList` above does: the
 * comma-separated form (`contractAddress=0xa,0xb`) and the repeated form
 * (`&contractAddress=0xa&contractAddress=0xb`, which `Params.getList` also accepts as `contractAddress[]`).
 * The comma form is what the Shop's seasonal events need: one event selects its items by tagging whole
 * collections in the builder and routinely names ~100 of them, and repeating the key costs 16 more
 * characters per address in a query string already approaching the usual 8 KB ceiling.
 *
 * `undefined` and `[]` mean DIFFERENT things downstream -- see `UnifiedCatalogFilters.contractAddresses`.
 * Two boundaries follow from that, both chosen to leave existing callers untouched:
 *
 * - A blank value (`contractAddress=`) reads as ABSENT, which is what it has always meant on this endpoint.
 * - A value that is present but is not an address yields `[]`, i.e. an empty page -- which is also what
 *   passing a non-address through the singular filter has always produced, since it matched no row.
 */
function contractAddressList(params: Params): string[] | undefined {
  const named = params
    .getList('contractAddress')
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean)

  if (named.length === 0) return undefined
  return named.filter(isAddress).map(address => address.toLowerCase())
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
    // Omitted = both, the pre-existing response. An unrecognized value DROPS the filter rather than being
    // rejected — `getValue` falls back to its default — so a typo returns both kinds, which for a caller
    // asking for `primary` is exactly the resales it meant to hide. The permissive direction, so it is
    // worth knowing: the Shop sends a fixed literal, but a hand-written request gets no error to read.
    const listingType = params.getValue<ShopListingType>('listingType', LISTING_TYPE_VALUES)
    const discounted = discountedParam(params)

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
        sortBy,
        listingType,
        discounted
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
    // One param, two shapes: a single collection reads as it always has, and several read as a set. The
    // singular is deliberately NOT sent alongside the set — with more than one value `getString` returns
    // only the first, and the two filters would then AND together into "the first address only".
    const contractAddresses = contractAddressList(params)
    const contractAddress = contractAddresses ? undefined : params.getString('contractAddress')
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
    // Omitted = both, which is the pre-existing behaviour. An unrecognized value DROPS the filter rather
    // than being rejected (`getValue` falls back to its default), so a typo returns everything — and for a
    // caller asking for `primary` that is the resales it meant to hide, with no error to notice.
    const listingType = params.getValue<ShopListingType>('listingType', LISTING_TYPE_VALUES)
    const groupBy = params.getValue<UnifiedGroupBy>('groupBy', GROUP_BY_VALUES, 'listing')
    // Same contract as every other feed: included unless `includeSocialEmotes=false` is sent, so the default
    // is byte-for-byte the pre-existing response. Read as a string rather than through the presence-based
    // `getBoolean`, which would read `includeSocialEmotes=false` as `true`.
    const includeSocialEmotes = params.getString('includeSocialEmotes') !== 'false'
    /**
     * Opt-in to CLASSIC (MANA-priced) RESALES from the legacy branch, which is primary-only without it.
     *
     * Read as a STRING compared against the literal 'true', not through the presence-based `getBoolean`:
     * that helper answers "was the key sent at all", so `includeLegacySecondary=false` would ENABLE the
     * thing it plainly asks to disable. For an opt-in whose default is the pre-existing feed, only an
     * explicit 'true' may change the answer -- an absent key, a 'false' or a typo all keep today's
     * response. (`includeSocialEmotes` compares against 'false' for the mirror-image reason.)
     */
    const includeLegacySecondary = params.getString('includeLegacySecondary') === 'true'
    const discounted = discountedParam(params)

    const filters = {
      first,
      skip,
      category,
      contractAddress,
      contractAddresses,
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
      includeSocialEmotes,
      includeLegacySecondary,
      discounted
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
    // Same opt-in as the grid this rail is meant to mirror — see the unified handler for why it is read as
    // a literal 'true'. A rail that included a row the grid excludes would contradict the page around it.
    const includeLegacySecondary = params.getString('includeLegacySecondary') === 'true'
    // And the same narrowing, for the same reason: the opt-in above covers the LEGACY branch only, while
    // native resales reach this rail unconditionally, so a caller that may not sell one has to say so.
    const listingType = params.getValue<ShopListingType>('listingType', LISTING_TYPE_VALUES)

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
      return shopCatalog.getRelatedItems({ contractAddress, itemId, first, includeLegacySecondary, listingType }, manaUsdRate.getRate())
    })
  }
}

/**
 * GET /v3/catalog/suggested -- the personalised rail: items this wallet is likely to want, drawn from
 * the same credit-buyable universe as the browse grid so the Shop renders them with the same card.
 *
 * The signature is OPTIONAL, and it buys exactly one thing: favourites. Everything else the rail reads
 * about a wallet -- what it holds, what it bought -- is already public through /v1/nfts?owner=, so
 * requiring a signature for that would buy no privacy while making the rail impossible to render for a
 * signed-out visitor who has local seeds. Favourites are not public anywhere else in this service, so
 * they are read only for the caller who PROVED they are that account.
 *
 * Every list parameter is capped rather than rejected when oversized: a client that sends 200 seeds
 * gets the first 20 considered, not a 400. `first` is the one exception the caller can get wrong in a
 * way worth reporting, and clampCount handles it silently for consistency with the other rails.
 */
export function createShopSuggestedHandler(
  components: Pick<AppComponents, 'suggestions' | 'manaUsdRate'>
): IHttpServerComponent.IRequestHandler<AuthenticatedContext<'/v3/catalog/suggested'>> {
  const { suggestions, manaUsdRate } = components

  return async context => {
    const params = new Params(context.url.searchParams)
    const address = params.getAddress('address')
    const first = params.getNumber('first', SUGGESTED_DEFAULT_LIMIT) ?? SUGGESTED_DEFAULT_LIMIT
    const verifiedAddress = context.verification?.auth?.toLowerCase()

    return asJSON(
      async () =>
        suggestions.getSuggestions(
          {
            address: address ?? undefined,
            verifiedAddress,
            seeds: csv(params.getString('seeds')),
            equipped: csv(params.getString('equipped')),
            exclude: csv(params.getString('exclude')),
            bodyShape: params.getString('bodyShape'),
            category: params.getString('category'),
            first
          },
          manaUsdRate.getRate()
        ),
      // Never stored by anything on the way out, and this is NOT covered by the internal cache being
      // keyed correctly. The signature travels in `x-identity-*` headers, so a shared cache keying on the
      // URL -- which is all a CDN or proxy has -- cannot tell a signed response from an unsigned one and
      // would happily hand a signed answer, favourites and all, to the next anonymous caller of the same
      // URL. `Vary: Authorization` would not help either: that is not the header in play. RFC 9111 §3.5.
      { 'Cache-Control': 'private, no-store' }
    )
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
    // Same opt-in as the grid — see the unified handler. Without it a Marketplace-listed copy can never
    // rank into the row, however much it trades, because the row is drawn from the same universe.
    const includeLegacySecondary = params.getString('includeLegacySecondary') === 'true'

    return asJSON(
      async () =>
        shopCatalog.getTrendingItems(
          {
            first,
            days,
            category,
            rarities,
            wearableCategories,
            listingType,
            source,
            includeSocialEmotes,
            includeLegacySecondary
          },
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
