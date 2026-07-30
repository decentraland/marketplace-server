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
  UnifiedItem,
  UnifiedItemRow,
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

// uint256 max, which the squid writes into `item.price` to mean "no price set" rather than leaving it NULL.
// A `price > 0` guard does NOT exclude it, so a store item carrying the sentinel would be advertised at
// ~1.16e42 credits. ports/catalog guards the same value the same way (`getMinPriceWhere`); kept as a string
// because the column is `numeric` and the value exceeds every JS number.
const NO_PRICE_SENTINEL = '115792089237316195423570985008687907853269984665640564039457584007913129639935'

// The metadata joins, keyed off whatever relation is aliased `mv`. Split out from `metadataJoins` so the
// CollectionStore branch can reuse them verbatim over its own base relation (see `storeBaseRelation`):
// every shared expression — `appendUnifiedFilters`, `genderExpr` — reads these aliases, so reusing the
// join chain is what makes the filters provably identical across branches rather than identical by
// inspection.
function metadataJoinsOn() {
  const s = MARKETPLACE_SQUID_SCHEMA
  return SQL`LEFT JOIN `
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

// The shared FROM + metadata joins used by the shop feed + the import feed. Resolves item metadata
// for primary (item_p -> wearable/emote) and secondary (nft + item_s) listings.
function metadataJoins() {
  return SQL`FROM marketplace.mv_trades mv
      `.append(metadataJoinsOn())
}

/**
 * The CollectionStore branch's base relation, shaped like `mv_trades` and aliased `mv`.
 *
 * A store item is NOT a trade: primary minting has no order and no signed listing. It is a property of the
 * item — the CollectionStore is a minter for its collection, and the buyer calls `CollectionStore.buy` at
 * `item.price`. So it cannot be recovered by filtering `mv_trades`; it needs its own source relation, which
 * is why the Shop's feed was missing it entirely.
 *
 * Projected into mv_trades' column names rather than given its own branch shape, so the metadata joins, the
 * gender expression and every browse filter apply UNCHANGED. That is the point: the alternative is a parallel
 * set of filter expressions that has to be kept in step by hand.
 *
 * The predicate mirrors `getIsOnSaleWithTrades` in ports/catalog (which backs the marketplace's "only
 * available for minting"), minus its V3-minter half — that half is the offchain primary trade the existing
 * branch already covers, and including it here would double-count every item.
 */
function storeBaseRelation(): SQLStatement {
  const s = MARKETPLACE_SQUID_SCHEMA
  return SQL`FROM (
        SELECT
          i.id AS id,
          'public_item_order'::text AS type,
          i.collection_id AS sent_contract_address,
          i.blockchain_id::text AS sent_item_id,
          NULL::text AS sent_token_id,
          NULL::text AS sent_nft_id,
          i.price AS amount_received,
          i.available AS available,
          i.network AS network,
          to_timestamp(i.created_at) AS created_at,
          NULL::jsonb AS assets
        FROM `
    .append(s)
    .append(
      // `search_is_collection_approved` is NOT optional: /v2/catalog applies it as a base WHERE, so omitting
      // it here would surface collections the marketplace hides. available > 0 drops sold-out mints (the
      // supply is finite and shrinks as other buyers mint), price > 0 drops free claims, which are not
      // sales and would otherwise be advertised as free items.
      SQL`.item i
        WHERE i.search_is_store_minter = true
          AND i.search_is_collection_approved = true
          AND i.available > 0
          AND i.price > 0
          AND i.price IS DISTINCT FROM ${NO_PRICE_SENTINEL}::numeric
      ) mv
      `
    )
    .append(metadataJoinsOn())
}

// Display gender as a SELECT expression, derived from the item's supported body shapes
// (search_wearable_body_shapes contains 'BaseMale'/'BaseFemale'). Both -> unisex, one -> that gender,
// neither/emote -> null. COALESCE(item_p, item_s) picks whichever side of the primary/secondary join
// is populated; ::text[] on both sides keeps the @> element types matching. No params -> safe to weave
// straight into the SELECT list.
function genderExpr() {
  return SQL`CASE
      WHEN COALESCE(item_p.search_wearable_body_shapes, item_s.search_wearable_body_shapes)::text[] @> ARRAY['BaseMale','BaseFemale']::text[] THEN 'unisex'
      WHEN COALESCE(item_p.search_wearable_body_shapes, item_s.search_wearable_body_shapes)::text[] @> ARRAY['BaseMale']::text[] THEN 'male'
      WHEN COALESCE(item_p.search_wearable_body_shapes, item_s.search_wearable_body_shapes)::text[] @> ARRAY['BaseFemale']::text[] THEN 'female'
      ELSE NULL
    END AS gender`
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
  if (filters.creator) {
    query.append(SQL` AND lower(COALESCE(item_p.creator, item_s.creator, '')) = ${filters.creator.toLowerCase()}`)
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
  if (filters.isSmart) {
    query.append(SQL` AND COALESCE(item_p.item_type, item_s.item_type, nft.item_type) = 'smart_wearable_v1'`)
  }
  if (filters.search) {
    query.append(SQL` AND COALESCE(nft.name, w_p.name, e_p.name) ILIKE ${'%' + escapeLike(filters.search) + '%'}`)
  }
  // Primary is a `public_item_order` (minting from a collection); anything else is a resale. Same
  // expression the row mapper uses for `listingType`, applied here so the filter and the reported value
  // can never disagree.
  if (filters.listingType === 'primary') {
    query.append(SQL` AND mv.type = 'public_item_order'`)
  } else if (filters.listingType === 'secondary') {
    query.append(SQL` AND mv.type <> 'public_item_order'`)
  }
}

// One branch of the unified UNION. `usdWei` is the USD-wei-equivalent expression: native listings are
// already USD-pegged (amount_received IS USD wei); legacy listings are MANA wei, so usdWei = amount *
// rate. Columns are identical across branches so the two can be UNIONed and sorted/paginated as one.
function unifiedBranch(opts: {
  source: 'native' | 'legacy'
  /** How the buyer acquires it: an offchain trade (`accept`) or a CollectionStore mint (`buy`). */
  acquisition: 'trade' | 'store'
  assetType: number
  primaryOnly: boolean
  applyRate: boolean
  rateNumericString: string
  filters: UnifiedCatalogFilters
}): SQLStatement {
  const { source, acquisition, assetType, primaryOnly, applyRate, rateNumericString, filters } = opts
  const isStore = acquisition === 'store'
  const usdWei = applyRate ? SQL`(mv.amount_received::numeric * ${rateNumericString}::numeric)` : SQL`mv.amount_received::numeric`

  const query = SQL`
      SELECT
        ${source} AS source,
        ${acquisition} AS acquisition,
        -- ::text because the branches are UNIONed and their ids have different column types: mv_trades.id is
        -- uuid, while the store relation carries item.id (varchar). Postgres refuses to match uuid with
        -- varchar across a UNION. Casting both to text is invisible downstream — the row type was already
        -- string — and keeps the ORDER BY tiebreaker deterministic.
        mv.id::text AS trade_id,
        mv.type::text AS trade_type,
        mv.sent_contract_address::text AS contract_address,
        mv.sent_item_id::text AS item_id,
        mv.sent_token_id::text AS token_id,
        COALESCE(nft.name, w_p.name, e_p.name) AS name,
        COALESCE(nft.image, item_p.image, item_s.image) AS image,
        COALESCE(item_p.rarity, item_s.rarity, nft.search_wearable_rarity) AS rarity,
        COALESCE(item_p.item_type, item_s.item_type, nft.item_type) AS item_type,
        COALESCE(
          item_p.search_wearable_category, item_p.search_emote_category,
          item_s.search_wearable_category, item_s.search_emote_category
        ) AS wearable_category,
        COALESCE(item_p.creator, item_s.creator, '') AS creator,
        mv.assets->'sent'->>'owner' AS seller,
        mv.assets->'sent'->>'issued_id' AS issued_id,
        `
    .append(usdWei)
    .append(
      SQL` AS usd_wei,
        mv.available::text AS available,
        mv.network::text AS network,
        EXTRACT(EPOCH FROM mv.created_at)::bigint * 1000 AS created_at,
        `
    )
    // Raw MANA price, exposed only for legacy (MANA-priced) items so the client can size the purchase
    // at the LIVE rate at checkout; native (USD-pegged) items carry no MANA price.
    .append(applyRate ? SQL`mv.amount_received::text AS mana_wei ` : SQL`NULL::text AS mana_wei `)
    .append(SQL`, `)
    .append(genderExpr())
    .append(SQL` `)
    // The store branch brings its own base relation; both then share the identical join chain and filters.
    .append(isStore ? storeBaseRelation() : metadataJoins())

  if (isStore) {
    // The store relation has already filtered itself (minter / approved / available / price) and has no
    // `status` column, no per-trade asset rows and nothing to restrict to primary — it is primary by
    // construction. So none of the trade-shaped predicates below apply.
    //
    // `WHERE TRUE` is load-bearing: appendUnifiedFilters emits ` AND <clause>` per filter, so it needs a
    // WHERE to append to. Without it a filtered request is a syntax error while an unfiltered one parses,
    // which is the worst failure shape — it works until someone picks a rarity.
    query.append(SQL` WHERE TRUE`)
    appendUnifiedFilters(query, filters)
    return query
  }

  query.append(SQL`
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

// Build the inner UNION ALL of the requested source branches (native and/or legacy). Shared by the
// per-listing unified feed and the item-unified browse feed so both draw from the SAME credit-buyable
// universe (native primary + native secondary + legacy primary) with identical filters. Legacy is
// primary-only here -- legacy ERC20 SECONDARY is Phase 3; adding it later is a one-line change (drop
// `primaryOnly`), and the item grouping/ordering below already extends to it unchanged.
function buildUnifiedInner(filters: UnifiedCatalogFilters, rateNumericString: string): SQLStatement {
  const parts: SQLStatement[] = []
  if (filters.source !== 'legacy') {
    parts.push(
      unifiedBranch({
        source: 'native',
        acquisition: 'trade',
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
        acquisition: 'trade',
        assetType: ERC20_ASSET_TYPE,
        primaryOnly: true,
        applyRate: true,
        rateNumericString,
        filters
      })
    )
    // CollectionStore mints. `source: 'legacy'` because they are MANA-priced and must inherit the legacy
    // price treatment exactly — server-converted at the live rate, re-priced client-side at checkout, and
    // hidden when no rate is available. What differs is only HOW you buy it, which is `acquisition`. Folding
    // these two orthogonal facts into one `source` enum is what would force every existing
    // `source === 'legacy'` branch to be re-audited.
    parts.push(
      unifiedBranch({
        source: 'legacy',
        acquisition: 'store',
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
  return inner
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
        mv.assets->'sent'->>'owner' AS seller,
        mv.assets->'sent'->>'issued_id' AS issued_id,
        mv.amount_received::text AS price,
        mv.available::text AS available,
        mv.network AS network,
        EXTRACT(EPOCH FROM mv.created_at)::bigint * 1000 AS created_at,
        COUNT(*) OVER() AS total
      `
      .append(SQL`, `)
      .append(genderExpr())
      .append(SQL` `)
      .append(metadataJoins()).append(SQL`
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
    if (filters.creator) {
      query.append(SQL` AND lower(COALESCE(item_p.creator, item_s.creator, '')) = ${filters.creator.toLowerCase()}`)
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
    if (filters.isSmart) {
      query.append(SQL` AND COALESCE(item_p.item_type, item_s.item_type, nft.item_type) = 'smart_wearable_v1'`)
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
        gender: r.gender ?? null,
        creator: r.creator ?? '',
        seller: r.seller ?? null,
        issuedId: r.issued_id ?? null,
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
      `
      .append(SQL`, `)
      .append(genderExpr())
      .append(SQL` `)
      .append(metadataJoins()).append(SQL`
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
        gender: r.gender ?? null,
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

    // Build only the requested branch(es); default is both, UNION ALL-ed together.
    const inner = buildUnifiedInner(filters, rateNumericString)

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
        acquisition: r.acquisition,
        // A store row has no trade; the SQL keeps the item id in trade_id only as a sort tiebreaker.
        tradeId: r.acquisition === 'store' ? null : r.trade_id,
        listingType: r.trade_type === 'public_item_order' ? 'primary' : 'secondary',
        contractAddress: r.contract_address,
        itemId: r.item_id,
        tokenId: r.token_id,
        name: r.name ?? '',
        thumbnail: r.image ?? '',
        rarity: (r.rarity ?? 'common').toLowerCase(),
        category: topLevelCategory(r.item_type),
        wearableCategory: r.wearable_category,
        gender: r.gender ?? null,
        creator: r.creator ?? '',
        seller: r.seller ?? null,
        issuedId: r.issued_id ?? null,
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

  // The item-unified BROWSE feed: the same credit-buyable universe as getUnifiedListings, but collapsed
  // to ONE row per (contract, item). Layered so each concern stays a distinct, reviewable SQL level:
  //   u  -- the UNION ALL of the source branches (one row per open credit-buyable listing).
  //   f  -- drop free/broken listings (usd_wei > 0) and attach a per-item listing_count window; this is
  //         the "N listings" badge count and it is stable across every row of the same item.
  //   d  -- DISTINCT ON (contract_address, item_id) keeps exactly one representative listing per item.
  //         The ORDER BY makes the survivor: PRIMARY before secondary, then NATIVE (fixed USD) before
  //         LEGACY (rate-floating MANA), then cheapest usd_wei, then trade_id for determinism. That is
  //         precisely "primary price if present, else cheapest credit-buyable secondary", preferring a
  //         stable USD headline over a rate-floating one. price_credits is CEIL(usd_wei / C) of the
  //         survivor (same "Model B" rounding as every other feed).
  // The outer query then applies the credit price-range on the HEADLINE price, the display sort, and
  // pagination, exposing COUNT(*) OVER() as the total number of items. sent_item_id is populated for
  // secondary rows too (mv_trades), so grouping needs no extra joins.
  async function getShopItems(filters: UnifiedCatalogFilters, manaUsdRate: number): Promise<{ data: UnifiedItem[]; total: number }> {
    const first = clampCount(filters.first, SHOP_DEFAULT_PAGE_SIZE, SHOP_MIN_PAGE_SIZE, SHOP_MAX_PAGE_SIZE)
    const skip = clampCount(filters.skip, 0, 0, Number.MAX_SAFE_INTEGER)
    const rateNumericString = rateToNumericString(manaUsdRate)

    const inner = buildUnifiedInner(filters, rateNumericString)

    const query = SQL`
      SELECT
        d.*,
        COUNT(*) OVER() AS total
      FROM (
        SELECT DISTINCT ON (f.contract_address, f.item_id)
          f.*,
          CEIL(f.usd_wei / ${USD_WEI_PER_CREDIT.toString()}::numeric)::bigint AS price_credits
        FROM (
          SELECT
            u.*,
            COUNT(*) OVER (PARTITION BY u.contract_address, u.item_id) AS listing_count
          FROM (`.append(inner).append(SQL`) u
          WHERE u.usd_wei > 0
        ) f
        ORDER BY
          f.contract_address,
          f.item_id,
          (CASE WHEN f.trade_type = 'public_item_order' THEN 0 ELSE 1 END),
          (CASE WHEN f.source = 'native' THEN 0 ELSE 1 END),
          f.usd_wei ASC,
          -- An item can be BOTH minting through the store and listed as an offchain primary trade, so the
          -- two branches can produce rows for the same item at the same price. Break that tie towards the
          -- trade: its price is signed into the order, whereas CollectionStore.buy re-validates the prices
          -- argument against the item's live on-chain price and reverts if it moved. Same price, strictly
          -- safer purchase. Below usd_wei so a genuinely cheaper store mint still wins on price.
          (CASE WHEN f.acquisition = 'trade' THEN 0 ELSE 1 END),
          f.trade_id
      ) d
      WHERE d.usd_wei > 0`)

    // Price-range on the item's DISPLAYED (headline) price -- see getUnifiedListings for the CEIL-consistent
    // lower bound (usd_wei > (m - 1) * C). listing_count is intentionally NOT narrowed by this filter: the
    // badge reflects how many listings the item has, independent of the price slider.
    if (filters.minPriceCredits != null) {
      const minWei = creditsToWei(filters.minPriceCredits)
      if (minWei != null && minWei > 0n) {
        query.append(SQL` AND d.usd_wei > ${(minWei - USD_WEI_PER_CREDIT).toString()}`)
      }
    }
    if (filters.maxPriceCredits != null) {
      const maxWei = creditsToWei(filters.maxPriceCredits)
      if (maxWei != null) query.append(SQL` AND d.usd_wei <= ${maxWei.toString()}`)
    }

    // Sort (fixed expressions only -- never interpolate user input into ORDER BY). A `d.trade_id`
    // tiebreaker keeps pagination stable when many items share a headline usd_wei/name.
    const order =
      filters.sortBy === 'cheapest'
        ? SQL` ORDER BY d.usd_wei ASC, d.trade_id`
        : filters.sortBy === 'most_expensive'
        ? SQL` ORDER BY d.usd_wei DESC, d.trade_id`
        : filters.sortBy === 'name'
        ? SQL` ORDER BY d.name ASC, d.trade_id`
        : SQL` ORDER BY d.created_at DESC, d.trade_id`
    query.append(order).append(SQL` LIMIT ${first} OFFSET ${skip}`)

    const result = await pg.query<UnifiedItemRow>(query)
    const polygonChainId = getPolygonChainId()
    const ethereumChainId = getEthereumChainId()
    const total = result.rows[0] ? Number(result.rows[0].total) : 0

    const data: UnifiedItem[] = result.rows.map(r => {
      const isPolygon = (r.network ?? Network.MATIC).toUpperCase() !== 'ETHEREUM'
      return {
        source: r.source,
        acquisition: r.acquisition,
        // A store row has no trade; the SQL keeps the item id in trade_id only as a sort tiebreaker.
        tradeId: r.acquisition === 'store' ? null : r.trade_id,
        listingType: r.trade_type === 'public_item_order' ? 'primary' : 'secondary',
        contractAddress: r.contract_address,
        itemId: r.item_id,
        tokenId: r.token_id,
        name: r.name ?? '',
        thumbnail: r.image ?? '',
        rarity: (r.rarity ?? 'common').toLowerCase(),
        category: topLevelCategory(r.item_type),
        wearableCategory: r.wearable_category,
        gender: r.gender ?? null,
        creator: r.creator ?? '',
        // Representative listing's seller + issued id (buildUnifiedInner carries both): populated when
        // the headline listing is a secondary (resale), null when it's a primary (mint).
        seller: r.seller ?? null,
        issuedId: r.issued_id ?? null,
        priceCredits: Number(r.price_credits),
        manaWei: r.mana_wei ?? null,
        listingCount: Number(r.listing_count),
        available: r.available ? Number(r.available) : 1,
        network: isPolygon ? Network.MATIC : Network.ETHEREUM,
        chainId: isPolygon ? polygonChainId : ethereumChainId,
        createdAt: Number(r.created_at)
      }
    })

    return { data, total }
  }

  return { getShopListings, getImportableListings, getLegacyListings, getUnifiedListings, getShopItems }
}
