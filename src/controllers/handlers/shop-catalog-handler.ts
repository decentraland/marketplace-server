import { IHttpServerComponent } from '@dcl/core-commons'
import { Params } from '../../logic/http/params'
import { asJSON } from '../../logic/http/response'
import { ShopSortBy, UnifiedListingSource, SHOP_DEFAULT_PAGE_SIZE, SHOP_MAX_PAGE_SIZE } from '../../ports/shop-catalog/types'
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

function csv(value?: string): string[] | undefined {
  const parts = value
    ?.split(',')
    .map(v => v.trim())
    .filter(Boolean)
  return parts && parts.length ? parts : undefined
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
    const rarities = csv(params.getString('rarity'))
    const wearableCategories = csv(params.getString('wearableCategory'))
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
        rarities,
        wearableCategories,
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
    const rarities = csv(params.getString('rarity'))
    const wearableCategories = csv(params.getString('wearableCategory'))
    const minPriceCredits = params.getNumber('minPriceCredits')
    const maxPriceCredits = params.getNumber('maxPriceCredits')
    const search = params.getString('search')
    const sortBy = params.getValue<ShopSortBy>('sortBy', SORT_VALUES)
    const source = params.getValue<UnifiedListingSource>('source', SOURCE_VALUES)

    return asJSON(async () => {
      const rate = manaUsdRate.getRate()
      const { data, total } = await shopCatalog.getUnifiedListings(
        {
          first,
          skip,
          category,
          contractAddress,
          itemId,
          rarities,
          wearableCategories,
          minPriceCredits,
          maxPriceCredits,
          search,
          sortBy,
          source
        },
        rate
      )
      return { data, total }
    })
  }
}

// GET /v3/catalog/items -- the credit-aware CATALOG-ITEMS feed. Same data source and full-catalog
// semantics as GET /v1/items (ALL items incl. not-on-sale, keyed by item, filterable by creator,
// contractAddress, category, rarity, search, ...) but every item carries a server-computed,
// asset-type-aware priceCredits (USD-pegged items pass through; MANA-priced ones are converted with the
// live MANA/USD rate). Returns { data, total } where each item is the /v1/items shape plus priceCredits.
export function createCatalogItemsHandler(
  components: Pick<AppComponents, 'items' | 'manaUsdRate'>
): IHttpServerComponent.IRequestHandler<Context<'/v3/catalog/items'>> {
  const { items, manaUsdRate } = components

  return async context => {
    const params = new Params(context.url.searchParams)
    const filters = getItemsParams(params)

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
