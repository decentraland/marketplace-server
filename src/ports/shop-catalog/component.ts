import SQL, { SQLStatement } from 'sql-template-strings'
import { Network, TradeAssetType } from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getEthereumChainId, getPolygonChainId } from '../../logic/chainIds'
import { AppComponents } from '../../types'
import {
  IShopCatalogComponent,
  ImportableListing,
  ImportableListingRow,
  LegacyCatalogFilters,
  LegacyListing,
  LegacyListingRow,
  ShopCatalogFilters,
  ShopListing,
  ShopListingRow,
  UnifiedCatalogFilters,
  UnifiedListing,
  UnifiedListingRow,
  SHOP_DEFAULT_PAGE_SIZE,
  SHOP_MAX_PAGE_SIZE,
  SHOP_MIN_PAGE_SIZE
} from './types'

// The received-asset type that marks a credit-buyable (Shop) listing, as opposed to a classic
// ERC20-MANA one. Sourced from @dcl/schemas so it stays in lockstep with the on-chain encoding.
const USD_PEGGED_ASSET_TYPE = TradeAssetType.USD_PEGGED_MANA
// A classic MANA-priced received asset: a listing that predates the Shop and can be imported.
const ERC20_ASSET_TYPE = TradeAssetType.ERC20

// The shared FROM + metadata joins used by the shop feed + the import feed. Resolves item metadata
// for primary (item_p -> wearable/emote) and secondary (nft + item_s) listings.
function metadataJoins() {
  const s = MARKETPLACE_SQUID_SCHEMA
  return SQL`FROM marketplace.mv_trades mv
      LEFT JOIN `
    .append(s)
    .append(
      SQL`.item item_p ON mv.type = 'public_item_order'
        AND item_p.collection_id = mv.sent_contract_address
        AND item_p.blockchain_id = mv.sent_item_id::numeric
      LEFT JOIN `
    )
    .append(s)
    .append(
      SQL`.metadata meta_p ON meta_p.id = item_p.metadata_id
      LEFT JOIN `
    )
    .append(s)
    .append(
      SQL`.wearable w_p ON w_p.id = meta_p.wearable_id
      LEFT JOIN `
    )
    .append(s)
    .append(
      SQL`.emote e_p ON e_p.id = meta_p.emote_id
      LEFT JOIN `
    )
    .append(s)
    .append(
      SQL`.nft nft ON mv.type = 'public_nft_order' AND nft.id = mv.sent_nft_id
      LEFT JOIN `
    )
    .append(s)
    .append(SQL`.item item_s ON mv.type = 'public_nft_order' AND item_s.id = nft.item_id`)
}

// 1 credit = $0.10; $1 = 1e18 USD wei = 10 credits, so 1 credit = 1e17 USD wei.
const USD_WEI_PER_CREDIT = 100000000000000000n

// Shop listings are created at whole-credit prices, so amount_received is expected to be an exact
// multiple of USD_WEI_PER_CREDIT. We round UP (ceil) as a defensive measure: a non-conforming price
// can then never be advertised for less than it would settle at on-chain. A non-positive or
// unparseable amount yields null so the caller can drop the row instead of advertising a free item.
function toCredits(usdWei: string): number | null {
  try {
    const wei = BigInt(usdWei)
    if (wei <= 0n) return null
    return Number((wei + USD_WEI_PER_CREDIT - 1n) / USD_WEI_PER_CREDIT)
  } catch {
    return null
  }
}

function topLevelCategory(itemType: string | null): string {
  return itemType?.toLowerCase().startsWith('emote') ? 'emote' : 'wearable'
}

// A whole-credit price bound -> USD wei. Returns null for non-finite input (e.g. `?minPriceCredits=Infinity`,
// which parseFloat accepts) so the caller can skip the filter instead of throwing on BigInt(Infinity).
function creditsToWei(credits: number): bigint | null {
  if (!Number.isFinite(credits)) return null
  return BigInt(Math.max(0, Math.floor(credits))) * USD_WEI_PER_CREDIT
}

// Escape LIKE/ILIKE metacharacters so user input is matched literally (Postgres default escape is `\`).
// The value is already bound as a parameter (no injection); this only stops `%`/`_` from turning a
// search into an unbounded wildcard scan.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

// Clamp a caller-supplied count to [min, max], flooring and falling back to `fallback` for
// missing/non-finite input.
function clampCount(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Math.floor(value as number) : fallback
  return Math.min(Math.max(n, min), max)
}

// Format a MANA/USD rate (USD per MANA) as a bounded-precision decimal literal for Postgres numeric
// math. A non-positive/non-finite rate yields '0' so the caller's `usd_wei > 0` guard drops the rows
// rather than advertising a free item off a broken rate.
function rateToNumericString(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '0'
  return rate.toFixed(18)
}

// The shared browse filters (category, contract/item, rarity, category, search) applied identically to
// each branch of the unified feed. Mirrors the expressions used by getShopListings.
function appendUnifiedFilters(query: SQLStatement, filters: UnifiedCatalogFilters): void {
  if (filters.contractAddress) {
    query.append(SQL` AND mv.sent_contract_address = ${filters.contractAddress.toLowerCase()}`)
  }
  if (filters.itemId != null) {
    query.append(SQL` AND mv.sent_item_id = ${filters.itemId}`)
  }
  if (filters.category === 'emote') {
    query.append(SQL` AND COALESCE(item_p.item_type, item_s.item_type, nft.item_type) ILIKE 'emote%'`)
  } else if (filters.category === 'wearable') {
    query.append(SQL` AND COALESCE(item_p.item_type, item_s.item_type, nft.item_type) NOT ILIKE 'emote%'`)
  }
  if (filters.rarities?.length) {
    query.append(
      SQL` AND lower(COALESCE(item_p.rarity, item_s.rarity, nft.search_wearable_rarity)) = ANY(${filters.rarities.map(r =>
        r.toLowerCase()
      )})`
    )
  }
  if (filters.wearableCategories?.length) {
    query.append(
      SQL` AND lower(COALESCE(item_p.search_wearable_category, item_s.search_wearable_category, item_p.search_emote_category, item_s.search_emote_category)) = ANY(${filters.wearableCategories.map(
        c => c.toLowerCase()
      )})`
    )
  }
  if (filters.search) {
    query.append(SQL` AND COALESCE(nft.name, w_p.name, e_p.name) ILIKE ${'%' + escapeLike(filters.search) + '%'}`)
  }
}

// One branch of the unified UNION. `usdWei` is the USD-wei-equivalent expression: native listings are
// already USD-pegged (amount_received IS USD wei); legacy listings are MANA wei, so usdWei = amount *
// rate. Columns are identical across branches so the two can be UNIONed and sorted/paginated as one.
function unifiedBranch(opts: {
  source: 'native' | 'legacy'
  assetType: number
  primaryOnly: boolean
  applyRate: boolean
  rateNumericString: string
  filters: UnifiedCatalogFilters
}): SQLStatement {
  const { source, assetType, primaryOnly, applyRate, rateNumericString, filters } = opts
  const usdWei = applyRate ? SQL`(mv.amount_received::numeric * ${rateNumericString}::numeric)` : SQL`mv.amount_received::numeric`

  const query = SQL`
      SELECT
        ${source} AS source,
        mv.id AS trade_id,
        mv.type AS trade_type,
        mv.sent_contract_address AS contract_address,
        mv.sent_item_id AS item_id,
        mv.sent_token_id AS token_id,
        COALESCE(nft.name, w_p.name, e_p.name) AS name,
        COALESCE(nft.image, item_p.image, item_s.image) AS image,
        COALESCE(item_p.rarity, item_s.rarity, nft.search_wearable_rarity) AS rarity,
        COALESCE(item_p.item_type, item_s.item_type, nft.item_type) AS item_type,
        COALESCE(
          item_p.search_wearable_category, item_p.search_emote_category,
          item_s.search_wearable_category, item_s.search_emote_category
        ) AS wearable_category,
        COALESCE(item_p.creator, item_s.creator, '') AS creator,
        `
    .append(usdWei)
    .append(
      SQL` AS usd_wei,
        mv.available::text AS available,
        mv.network AS network,
        EXTRACT(EPOCH FROM mv.created_at)::bigint * 1000 AS created_at,
        `
    )
    // Raw MANA price, exposed only for legacy (MANA-priced) items so the client can size the purchase
    // at the LIVE rate at checkout; native (USD-pegged) items carry no MANA price.
    .append(applyRate ? SQL`mv.amount_received::text AS mana_wei` : SQL`NULL::text AS mana_wei`)
    .append(metadataJoins()).append(SQL`
      WHERE mv.status = 'open'
        AND (mv.available IS NULL OR mv.available > 0)`)

  if (primaryOnly) {
    query.append(SQL` AND mv.type = 'public_item_order'`)
  }
  query.append(SQL`
        AND EXISTS (
          SELECT 1 FROM marketplace.trade_assets ta
          WHERE ta.trade_id = mv.id AND ta.direction = 'received' AND ta.asset_type = ${assetType}
        )`)

  appendUnifiedFilters(query, filters)
  return query
}

export function createShopCatalogComponent(components: Pick<AppComponents, 'dappsDatabase' | 'logs'>): IShopCatalogComponent {
  const { dappsDatabase: pg } = components
  const logger = components.logs.getLogger('shop-catalog-component')

  async function getShopListings(filters: ShopCatalogFilters): Promise<{ data: ShopListing[]; total: number }> {
    const first = clampCount(filters.first, SHOP_DEFAULT_PAGE_SIZE, SHOP_MIN_PAGE_SIZE, SHOP_MAX_PAGE_SIZE)
    const skip = clampCount(filters.skip, 0, 0, Number.MAX_SAFE_INTEGER)

    const query = SQL`
      SELECT
        mv.id AS trade_id,
        mv.type AS trade_type,
        mv.sent_contract_address AS contract_address,
        mv.sent_item_id AS item_id,
        mv.sent_token_id AS token_id,
        COALESCE(nft.name, w_p.name, e_p.name) AS name,
        COALESCE(nft.image, item_p.image, item_s.image) AS image,
        COALESCE(item_p.rarity, item_s.rarity, nft.search_wearable_rarity) AS rarity,
        COALESCE(item_p.item_type, item_s.item_type, nft.item_type) AS item_type,
        COALESCE(
          item_p.search_wearable_category, item_p.search_emote_category,
          item_s.search_wearable_category, item_s.search_emote_category
        ) AS wearable_category,
        COALESCE(item_p.creator, item_s.creator, '') AS creator,
        mv.amount_received::text AS price,
        mv.available::text AS available,
        mv.network AS network,
        EXTRACT(EPOCH FROM mv.created_at)::bigint * 1000 AS created_at,
        COUNT(*) OVER() AS total
      `.append(metadataJoins()).append(SQL`
      WHERE mv.status = 'open'
        AND (mv.available IS NULL OR mv.available > 0)
        AND EXISTS (
          SELECT 1 FROM marketplace.trade_assets ta
          WHERE ta.trade_id = mv.id AND ta.direction = 'received' AND ta.asset_type = ${USD_PEGGED_ASSET_TYPE}
        )`)

    if (filters.contractAddress) {
      query.append(SQL` AND mv.sent_contract_address = ${filters.contractAddress.toLowerCase()}`)
    }
    if (filters.itemId != null) {
      query.append(SQL` AND mv.sent_item_id = ${filters.itemId}`)
    }
    if (filters.category === 'emote') {
      query.append(SQL` AND COALESCE(item_p.item_type, item_s.item_type, nft.item_type) ILIKE 'emote%'`)
    } else if (filters.category === 'wearable') {
      query.append(SQL` AND COALESCE(item_p.item_type, item_s.item_type, nft.item_type) NOT ILIKE 'emote%'`)
    }
    if (filters.rarities?.length) {
      query.append(
        SQL` AND lower(COALESCE(item_p.rarity, item_s.rarity, nft.search_wearable_rarity)) = ANY(${filters.rarities.map(r =>
          r.toLowerCase()
        )})`
      )
    }
    if (filters.wearableCategories?.length) {
      query.append(
        SQL` AND lower(COALESCE(item_p.search_wearable_category, item_s.search_wearable_category, item_p.search_emote_category, item_s.search_emote_category)) = ANY(${filters.wearableCategories.map(
          c => c.toLowerCase()
        )})`
      )
    }
    if (filters.minPriceCredits != null) {
      const minWei = creditsToWei(filters.minPriceCredits)
      if (minWei != null) query.append(SQL` AND mv.amount_received >= ${minWei.toString()}`)
    }
    if (filters.maxPriceCredits != null) {
      const maxWei = creditsToWei(filters.maxPriceCredits)
      if (maxWei != null) query.append(SQL` AND mv.amount_received <= ${maxWei.toString()}`)
    }
    if (filters.search) {
      query.append(SQL` AND COALESCE(nft.name, w_p.name, e_p.name) ILIKE ${'%' + escapeLike(filters.search) + '%'}`)
    }

    // Sort (fixed expressions only -- never interpolate user input into ORDER BY).
    const order =
      filters.sortBy === 'cheapest'
        ? SQL` ORDER BY mv.amount_received ASC`
        : filters.sortBy === 'most_expensive'
        ? SQL` ORDER BY mv.amount_received DESC`
        : filters.sortBy === 'name'
        ? SQL` ORDER BY COALESCE(nft.name, w_p.name, e_p.name) ASC`
        : SQL` ORDER BY mv.created_at DESC`
    query.append(order).append(SQL` LIMIT ${first} OFFSET ${skip}`)

    const result = await pg.query<ShopListingRow>(query)
    const polygonChainId = getPolygonChainId()
    const ethereumChainId = getEthereumChainId()
    const total = result.rows[0] ? Number(result.rows[0].total) : 0

    const data: ShopListing[] = []
    for (const r of result.rows) {
      const priceCredits = toCredits(r.price)
      if (priceCredits === null) {
        logger.warn('Dropping shop listing with non-positive or unparseable price', { tradeId: r.trade_id, price: r.price })
        continue
      }
      const isPolygon = (r.network ?? Network.MATIC).toUpperCase() !== 'ETHEREUM'
      data.push({
        tradeId: r.trade_id,
        listingType: r.trade_type === 'public_item_order' ? 'primary' : 'secondary',
        contractAddress: r.contract_address,
        itemId: r.item_id,
        tokenId: r.token_id,
        name: r.name ?? '',
        thumbnail: r.image ?? '',
        rarity: (r.rarity ?? 'common').toLowerCase(),
        category: topLevelCategory(r.item_type),
        wearableCategory: r.wearable_category,
        creator: r.creator ?? '',
        priceCredits,
        available: r.available ? Number(r.available) : 1,
        network: isPolygon ? Network.MATIC : Network.ETHEREUM,
        chainId: isPolygon ? polygonChainId : ethereumChainId,
        createdAt: Number(r.created_at)
      })
    }

    return { data, total }
  }

  // A seller's OPEN classic (ERC20-MANA) listings -- the "old liquidity" they can import into the
  // Shop. Both primary (public_item_order) and secondary (public_nft_order). Price is returned raw
  // (MANA wei); the client converts to credits via the oracle. USD-pegged ones are excluded (they're
  // already in the Shop).
  async function getImportableListings(seller: string): Promise<ImportableListing[]> {
    const query = SQL`
      SELECT
        mv.id AS old_trade_id,
        mv.type AS trade_type,
        mv.sent_contract_address AS contract_address,
        mv.sent_item_id AS item_id,
        mv.sent_token_id AS token_id,
        COALESCE(nft.name, w_p.name, e_p.name) AS name,
        COALESCE(nft.image, item_p.image, item_s.image) AS image,
        COALESCE(item_p.rarity, item_s.rarity, nft.search_wearable_rarity) AS rarity,
        COALESCE(item_p.item_type, item_s.item_type, nft.item_type) AS item_type,
        COALESCE(
          item_p.search_wearable_category, item_p.search_emote_category,
          item_s.search_wearable_category, item_s.search_emote_category
        ) AS wearable_category,
        mv.amount_received::text AS mana_wei,
        mv.available::text AS available,
        mv.network AS network
      `
      .append(metadataJoins())
      .append(
        SQL`
      WHERE mv.status = 'open'
        AND (mv.available IS NULL OR mv.available > 0)
        AND lower(mv.signer) = ${seller.toLowerCase()}
        AND EXISTS (
          SELECT 1 FROM marketplace.trade_assets ta
          WHERE ta.trade_id = mv.id AND ta.direction = 'received' AND ta.asset_type = ${ERC20_ASSET_TYPE}
        )
      ORDER BY mv.created_at DESC
      LIMIT ${SHOP_MAX_PAGE_SIZE}`
      )

    const result = await pg.query<ImportableListingRow>(query)
    const polygonChainId = getPolygonChainId()
    const ethereumChainId = getEthereumChainId()

    return result.rows.map(r => {
      const isPolygon = (r.network ?? Network.MATIC).toUpperCase() !== 'ETHEREUM'
      return {
        oldTradeId: r.old_trade_id,
        listingType: r.trade_type === 'public_item_order' ? 'primary' : 'secondary',
        contractAddress: r.contract_address,
        itemId: r.item_id,
        tokenId: r.token_id,
        name: r.name ?? '',
        thumbnail: r.image ?? '',
        rarity: (r.rarity ?? 'common').toLowerCase(),
        category: topLevelCategory(r.item_type),
        wearableCategory: r.wearable_category,
        manaWei: r.mana_wei,
        available: r.available ? Number(r.available) : 1,
        network: isPolygon ? Network.MATIC : Network.ETHEREUM,
        chainId: isPolygon ? polygonChainId : ethereumChainId
      }
    })
  }

  // The classic (ERC20-MANA) PRIMARY listings -- the "old liquidity" the Shop can offer for purchase
  // with credits. Mirrors getShopListings but filters classic ERC20 received assets (asset_type = 1)
  // instead of USD-pegged (asset_type = 2), restricts to primaries (public_item_order) since
  // secondary-with-credits is disabled, and returns the RAW MANA price (the client converts to credits
  // via the oracle). Paginated public browse feed; no price-range filter in v1 (that needs a live rate).
  async function getLegacyListings(filters: LegacyCatalogFilters): Promise<{ data: LegacyListing[]; total: number }> {
    const first = clampCount(filters.first, SHOP_DEFAULT_PAGE_SIZE, SHOP_MIN_PAGE_SIZE, SHOP_MAX_PAGE_SIZE)
    const skip = clampCount(filters.skip, 0, 0, Number.MAX_SAFE_INTEGER)

    const query = SQL`
      SELECT
        mv.id AS trade_id,
        mv.sent_contract_address AS contract_address,
        mv.sent_item_id AS item_id,
        COALESCE(w_p.name, e_p.name) AS name,
        item_p.image AS image,
        item_p.rarity AS rarity,
        item_p.item_type AS item_type,
        COALESCE(item_p.search_wearable_category, item_p.search_emote_category) AS wearable_category,
        COALESCE(item_p.creator, '') AS creator,
        mv.amount_received::text AS mana_wei,
        mv.available::text AS available,
        mv.network AS network,
        EXTRACT(EPOCH FROM mv.created_at)::bigint * 1000 AS created_at,
        COUNT(*) OVER() AS total
      `.append(metadataJoins()).append(SQL`
      WHERE mv.status = 'open'
        AND mv.type = 'public_item_order'
        AND (mv.available IS NULL OR mv.available > 0)
        AND EXISTS (
          SELECT 1 FROM marketplace.trade_assets ta
          WHERE ta.trade_id = mv.id AND ta.direction = 'received' AND ta.asset_type = ${ERC20_ASSET_TYPE}
        )`)

    if (filters.category === 'emote') {
      query.append(SQL` AND item_p.item_type ILIKE 'emote%'`)
    } else if (filters.category === 'wearable') {
      query.append(SQL` AND item_p.item_type NOT ILIKE 'emote%'`)
    }
    if (filters.rarities?.length) {
      query.append(SQL` AND lower(item_p.rarity) = ANY(${filters.rarities.map(r => r.toLowerCase())})`)
    }
    if (filters.wearableCategories?.length) {
      query.append(
        SQL` AND lower(COALESCE(item_p.search_wearable_category, item_p.search_emote_category)) = ANY(${filters.wearableCategories.map(c =>
          c.toLowerCase()
        )})`
      )
    }
    if (filters.search) {
      query.append(SQL` AND COALESCE(w_p.name, e_p.name) ILIKE ${'%' + escapeLike(filters.search) + '%'}`)
    }

    // Sort (fixed expressions only -- never interpolate user input into ORDER BY).
    const order =
      filters.sortBy === 'cheapest'
        ? SQL` ORDER BY mv.amount_received ASC`
        : filters.sortBy === 'most_expensive'
        ? SQL` ORDER BY mv.amount_received DESC`
        : filters.sortBy === 'name'
        ? SQL` ORDER BY COALESCE(w_p.name, e_p.name) ASC`
        : SQL` ORDER BY mv.created_at DESC`
    query.append(order).append(SQL` LIMIT ${first} OFFSET ${skip}`)

    const result = await pg.query<LegacyListingRow>(query)
    const polygonChainId = getPolygonChainId()
    const ethereumChainId = getEthereumChainId()
    const total = result.rows[0] ? Number(result.rows[0].total) : 0

    const data: LegacyListing[] = result.rows.map(r => {
      const isPolygon = (r.network ?? Network.MATIC).toUpperCase() !== 'ETHEREUM'
      return {
        tradeId: r.trade_id,
        listingType: 'primary',
        contractAddress: r.contract_address,
        itemId: r.item_id,
        name: r.name ?? '',
        thumbnail: r.image ?? '',
        rarity: (r.rarity ?? 'common').toLowerCase(),
        category: topLevelCategory(r.item_type),
        wearableCategory: r.wearable_category,
        creator: r.creator ?? '',
        manaWei: r.mana_wei,
        available: r.available ? Number(r.available) : 1,
        network: isPolygon ? Network.MATIC : Network.ETHEREUM,
        chainId: isPolygon ? polygonChainId : ethereumChainId,
        createdAt: Number(r.created_at)
      }
    })

    return { data, total }
  }

  // The UNIFIED feed: native (USD-pegged) + legacy (classic MANA) primaries in ONE credit-priced set.
  // Legacy MANA prices are converted to a USD-wei-equivalent (amount * rate) so priceCredits, the
  // price-range filter and the sort are all computed uniformly across both sources. priceCredits is
  // CEIL(usd_wei / USD_WEI_PER_CREDIT) -- whole credits rounded UP, same "Model B" as the native path.
  async function getUnifiedListings(
    filters: UnifiedCatalogFilters,
    manaUsdRate: number
  ): Promise<{ data: UnifiedListing[]; total: number }> {
    const first = clampCount(filters.first, SHOP_DEFAULT_PAGE_SIZE, SHOP_MIN_PAGE_SIZE, SHOP_MAX_PAGE_SIZE)
    const skip = clampCount(filters.skip, 0, 0, Number.MAX_SAFE_INTEGER)
    const rateNumericString = rateToNumericString(manaUsdRate)

    // Build only the requested branch(es); default is both. `parts` are UNION ALL-ed together.
    const parts: SQLStatement[] = []
    if (filters.source !== 'legacy') {
      parts.push(
        unifiedBranch({
          source: 'native',
          assetType: USD_PEGGED_ASSET_TYPE,
          primaryOnly: false,
          applyRate: false,
          rateNumericString,
          filters
        })
      )
    }
    if (filters.source !== 'native') {
      parts.push(
        unifiedBranch({
          source: 'legacy',
          assetType: ERC20_ASSET_TYPE,
          primaryOnly: true,
          applyRate: true,
          rateNumericString,
          filters
        })
      )
    }

    const inner = parts[0]
    for (let i = 1; i < parts.length; i++) {
      inner.append(SQL` UNION ALL `).append(parts[i])
    }

    // Wrap the union so priceCredits, the price-range filter and the sort operate on the merged set.
    const query = SQL`
      SELECT
        sub.*,
        CEIL(sub.usd_wei / ${USD_WEI_PER_CREDIT.toString()}::numeric)::bigint AS price_credits,
        COUNT(*) OVER() AS total
      FROM (`.append(inner).append(SQL`) sub
      WHERE sub.usd_wei > 0`)

    // minPriceCredits is a floor on the DISPLAYED price, which is CEIL(usd_wei / USD_WEI_PER_CREDIT).
    // CEIL(x / C) >= m  <=>  x > (m - 1) * C, so the correct bound on usd_wei is (minWei - USD_WEI_PER_CREDIT).
    // A plain `usd_wei >= minWei` (minWei = m * C) wrongly drops fractional-priced legacy items whose CEIL
    // equals m but whose usd_wei sits just below m * C. Skip the filter when the bound would go negative
    // (m <= 0), where every priced item (usd_wei > 0) already qualifies.
    if (filters.minPriceCredits != null) {
      const minWei = creditsToWei(filters.minPriceCredits)
      if (minWei != null && minWei > 0n) {
        query.append(SQL` AND sub.usd_wei > ${(minWei - USD_WEI_PER_CREDIT).toString()}`)
      }
    }
    if (filters.maxPriceCredits != null) {
      const maxWei = creditsToWei(filters.maxPriceCredits)
      if (maxWei != null) query.append(SQL` AND sub.usd_wei <= ${maxWei.toString()}`)
    }

    // Sort (fixed expressions only -- never interpolate user input into ORDER BY). A `sub.trade_id`
    // tiebreaker makes the order total so pagination is stable when many rows share a usd_wei/name.
    const order =
      filters.sortBy === 'cheapest'
        ? SQL` ORDER BY sub.usd_wei ASC, sub.trade_id`
        : filters.sortBy === 'most_expensive'
        ? SQL` ORDER BY sub.usd_wei DESC, sub.trade_id`
        : filters.sortBy === 'name'
        ? SQL` ORDER BY sub.name ASC, sub.trade_id`
        : SQL` ORDER BY sub.created_at DESC, sub.trade_id`
    query.append(order).append(SQL` LIMIT ${first} OFFSET ${skip}`)

    const result = await pg.query<UnifiedListingRow>(query)
    const polygonChainId = getPolygonChainId()
    const ethereumChainId = getEthereumChainId()
    const total = result.rows[0] ? Number(result.rows[0].total) : 0

    const data: UnifiedListing[] = result.rows.map(r => {
      const isPolygon = (r.network ?? Network.MATIC).toUpperCase() !== 'ETHEREUM'
      return {
        source: r.source,
        tradeId: r.trade_id,
        listingType: r.trade_type === 'public_item_order' ? 'primary' : 'secondary',
        contractAddress: r.contract_address,
        itemId: r.item_id,
        tokenId: r.token_id,
        name: r.name ?? '',
        thumbnail: r.image ?? '',
        rarity: (r.rarity ?? 'common').toLowerCase(),
        category: topLevelCategory(r.item_type),
        wearableCategory: r.wearable_category,
        creator: r.creator ?? '',
        priceCredits: Number(r.price_credits),
        manaWei: r.mana_wei ?? null,
        available: r.available ? Number(r.available) : 1,
        network: isPolygon ? Network.MATIC : Network.ETHEREUM,
        chainId: isPolygon ? polygonChainId : ethereumChainId,
        createdAt: Number(r.created_at)
      }
    })

    return { data, total }
  }

  return { getShopListings, getImportableListings, getLegacyListings, getUnifiedListings }
}
