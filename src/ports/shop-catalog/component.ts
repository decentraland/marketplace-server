import SQL, { SQLStatement } from 'sql-template-strings'
import { GenderFilterOption, Network, Rarity, TradeAssetType } from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getSearchMatchWhere } from '../../logic/catalog/search-match'
import { getEthereumChainId, getPolygonChainId } from '../../logic/chainIds'
import { AppComponents } from '../../types'
// The SAME window helper the marketplace's /v1/trendings row uses. Imported rather than reimplemented so the
// two rows provably span the same slice of history — a second copy of "midnight, N days ago" is exactly the
// kind of thing that drifts by an hour and makes the two rows quietly disagree.
import { getDateXDaysAgo } from '../trendings/utils'
import {
  IShopCatalogComponent,
  ImportableListing,
  ImportableListingRow,
  LegacyCatalogFilters,
  LegacyListing,
  LegacyListingRow,
  ReferenceItem,
  ReferenceItemRow,
  RelatedItemRow,
  RelatedItemsFilters,
  ShopCatalogFilters,
  ShopListing,
  ShopListingRow,
  TrendingItem,
  TrendingItemRow,
  TrendingItemsFilters,
  UnifiedCatalogFilters,
  UnifiedItem,
  UnifiedItemRow,
  UnifiedListing,
  UnifiedListingRow,
  RELATED_DEFAULT_LIMIT,
  RELATED_MAX_LIMIT,
  SHOP_DEFAULT_PAGE_SIZE,
  SHOP_MAX_PAGE_SIZE,
  SHOP_MIN_PAGE_SIZE,
  TRENDING_DEFAULT_DAYS,
  TRENDING_DEFAULT_LIMIT,
  TRENDING_MAX_DAYS,
  TRENDING_MAX_LIMIT,
  TRENDING_MIN_DAYS,
  TRENDING_SALES_CUT,
  TOP_CREATORS_DEFAULT_DAYS,
  TOP_CREATORS_DEFAULT_LIMIT,
  TOP_CREATORS_MAX_DAYS,
  TOP_CREATORS_MAX_LIMIT,
  TOP_CREATORS_MIN_ITEMS,
  TOP_CREATORS_MIN_DAYS,
  TOP_CREATORS_MIN_SALES_PER_WINDOW,
  TOP_CREATORS_MIN_WINDOW_SALES_FLOOR,
  TopCreator,
  TopCreatorRow,
  TopCreatorsFilters
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

/**
 * Upper bound on a row's USD-wei price, applied before `price_credits` is cast to bigint.
 *
 * Without it an absurd price does not merely render badly — `CEIL(usd_wei / C)::bigint` raises
 * `bigint out of range` and the ENTIRE query aborts, so one bad item 500s the catalogue for every user. The
 * sentinel guard above does not cover this: `sentinel - 1` clears it and still overflows.
 *
 * 1e30 USD wei is $1e12, or 10 trillion credits — orders of magnitude above any real item, and ~1e6 below
 * the bigint ceiling, so the cast has room. Rows above it are dropped rather than fatal.
 */
const MAX_USD_WEI = '1000000000000000000000000000000'

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
          -- No seller and no issued id for a mint. NULL::jsonb rather than an empty object because the shared
          -- SELECT reads mv.assets->'sent'->>'owner' and ->>'issued_id': Postgres propagates NULL through both
          -- JSON operators, so those columns come back null with no branch in the SELECT list.
          NULL::jsonb AS assets
        FROM `
    .append(s)
    .append(
      // Each predicate, and why it is here rather than assumed:
      //
      // `search_is_collection_approved` mirrors the base WHERE /v2/catalog applies. NOTE it constrains only
      // THIS branch — the trade branches carry no approval check, so an unapproved collection with an open
      // trade is still reachable through the feed. Narrowing that is a change to existing behaviour and is
      // deliberately out of scope here; this stops the store branch from ADDING to the exposure.
      //
      // `available > 0` drops sold-out mints: store supply is finite and shrinks as other buyers mint, so it
      // has to be read at query time rather than trusted from an earlier snapshot.
      //
      // `price > 0` drops free claims, which are not sales and would be advertised as free items.
      //
      // `search_emote_outcome_type IS NULL` excludes SOCIAL emotes, which the marketplace deliberately hides
      // (its clients all send includeSocialEmotes=false). The store branch is where the bulk of the minting
      // catalogue enters, so without this the Shop would surface what the marketplace suppresses.
      //
      // `network <> 'ETHEREUM'` is insurance, not a live fix: every store row is Polygon today. But this row
      // tells the client to call CollectionStore.buy, which exists only on Polygon, so an L1 row would offer
      // a purchase that cannot settle. The trade branches need no equivalent — their network is a real
      // property of the trade.
      SQL`.item i
        WHERE i.search_is_store_minter = true
          AND i.search_is_collection_approved = true
          AND i.available > 0
          AND i.price > 0
          AND i.price IS DISTINCT FROM ${NO_PRICE_SENTINEL}::numeric
          AND i.search_emote_outcome_type IS NULL
          AND i.network <> 'ETHEREUM'
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

// The body shapes an item must declare to satisfy a `wearableGender` filter. Mirrors the mapping
// /v1/items uses (ports/items/queries getGenderWhereStatement): UNISEX asks for both shapes, so it is
// the same request as MALE + FEMALE. Returns [] when nothing recognizable was asked for, which leaves
// the feed unfiltered rather than silently empty.
function genderBodyShapes(genders: GenderFilterOption[]): string[] {
  const hasUnisex = genders.includes(GenderFilterOption.UNISEX)
  const bodyShapes: string[] = []
  if (hasUnisex || genders.includes(GenderFilterOption.MALE)) {
    bodyShapes.push('BaseMale')
  }
  if (hasUnisex || genders.includes(GenderFilterOption.FEMALE)) {
    bodyShapes.push('BaseFemale')
  }
  return bodyShapes
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

// The item behind a row, whichever side of the trade it came from: primary listings resolve through
// item_p, secondary ones through the nft to item_s. Both aliases come from metadataJoinsOn.
const SHOP_ITEM_ID_EXPRESSION = 'COALESCE(item_p.id, item_s.id)::text'

// A trade whose item belongs to a collection curation did not approve is not something to list, mirroring
// the base WHERE /v2/catalog applies. Rows whose sent asset is not a collection item at all -- LAND,
// estates, names -- have no collection to judge, so they stay: COALESCE cannot tell "no item" from "item
// with a NULL flag", which is why the two cases are spelled out rather than defaulted.
const APPROVED_COLLECTION_PREDICATE = `(
    COALESCE(item_p.id, item_s.id) IS NULL
    OR COALESCE(item_p.search_is_collection_approved, item_s.search_is_collection_approved) = true
  )`

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
  query.append(SQL` AND `).append(APPROVED_COLLECTION_PREDICATE)
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
  // Same column, COALESCE and ::text[] cast as `genderExpr`, so what this selects and what the row
  // reports as `gender` can never disagree. `@>` is "declares all of these", which is what makes
  // `wearableGender=male` mean "wearable BY a male avatar" -- male-exclusive items plus unisex ones --
  // rather than male-exclusive only. An emote declares no wearable body shapes, so it matches nothing
  // here; that is the same wearables-only scope the param has on /v1/items.
  if (filters.wearableGenders?.length) {
    const bodyShapes = genderBodyShapes(filters.wearableGenders)
    if (bodyShapes.length) {
      query.append(
        SQL` AND COALESCE(item_p.search_wearable_body_shapes, item_s.search_wearable_body_shapes)::text[] @> ${bodyShapes}::text[]`
      )
    }
  }
  if (filters.search) {
    query.append(SQL` AND `).append(getSearchMatchWhere(SHOP_ITEM_ID_EXPRESSION, filters.search))
  }
  // Social emotes are INCLUDED by default and excluded only on an explicit `includeSocialEmotes=false`,
  // matching /v1/items, /v2/catalog and /v1/trendings so one convention covers every feed. COALESCE over
  // both item joins so it lands on primary (item_p) and secondary (item_s) rows alike; the store branch
  // already excludes them at its base relation, so this is a no-op there rather than a second rule.
  if (filters.includeSocialEmotes === false) {
    query.append(SQL` AND COALESCE(item_p.search_emote_outcome_type, item_s.search_emote_outcome_type) IS NULL`)
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

// The item-unified core: the UNION ALL of the source branches collapsed to ONE representative listing per
// (contract, item). Layered so each concern stays a distinct, reviewable SQL level:
//   u  -- the UNION ALL of the source branches (one row per open credit-buyable offer).
//   f  -- drop free/broken offers (usd_wei > 0) and absurd ones (<= MAX_USD_WEI, which keeps the bigint cast
//         below from aborting the whole query), then attach a per-item listing_count window; this is the
//         "N listings" badge count and it is stable across every row of the same item.
//   d  -- DISTINCT ON (contract_address, item_id) keeps exactly one representative offer per item.
//         The ORDER BY makes the survivor: PRIMARY before secondary, then NATIVE (fixed USD) before
//         LEGACY (rate-floating MANA), then cheapest usd_wei, then TRADE before STORE mint, then trade_id
//         for determinism. That is precisely "primary price if present, else cheapest credit-buyable
//         secondary", preferring a stable USD headline over a rate-floating one. price_credits is
//         CEIL(usd_wei / C) of the survivor (same "Model B" rounding as every other feed).
// Callers wrap this as `d` and add their own filtering/ordering/pagination on top. sent_item_id is
// populated for secondary rows too (mv_trades), so grouping needs no extra joins.
//
// Shared by the browse feed and the related-items rail so the rail is drawn from exactly the same universe,
// grouping and headline-price rules as the grid it is meant to mirror -- a divergence here would show the
// same item at two different prices on two screens.
function buildItemUnifiedCore(filters: UnifiedCatalogFilters, rateNumericString: string): SQLStatement {
  const inner = buildUnifiedInner(filters, rateNumericString)

  return SQL`SELECT DISTINCT ON (f.contract_address, f.item_id)
          f.*,
          CEIL(f.usd_wei / ${USD_WEI_PER_CREDIT.toString()}::numeric)::bigint AS price_credits
        FROM (
          SELECT
            u.*,
            COUNT(*) OVER (PARTITION BY u.contract_address, u.item_id) AS listing_count
          FROM (`.append(inner).append(SQL`) u
          WHERE u.usd_wei > 0 AND u.usd_wei <= ${MAX_USD_WEI}::numeric
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
          f.trade_id`)
}

/**
 * Row -> model for both unified feeds. They differ only in `listingCount`, which the item feed spreads on top.
 *
 * Shared because the two copies had already drifted apart in their comments, and the next field added to one
 * would silently be missing from the other — the per-listing feed backs the PDP resale view while the item
 * feed backs the browse grid, so a divergence shows up as the same item described two different ways.
 */
// `total` is omitted from the parameter (not read here) so the unpaginated related-items rail, whose rows
// carry no COUNT(*) OVER(), can be mapped by this very function instead of a near-copy of it.
function mapUnifiedRow(r: Omit<UnifiedListingRow, 'total'>, polygonChainId: number, ethereumChainId: number): UnifiedListing {
  const isPolygon = (r.network ?? Network.MATIC).toUpperCase() !== 'ETHEREUM'
  return {
    source: r.source,
    acquisition: r.acquisition,
    // A store row has no trade; the SQL keeps the item id in trade_id only as a DISTINCT ON tiebreaker, and
    // dropping it here is what stops a nonexistent trade reference reaching POST /credits/authorize.
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
    // Seller + issued id come from `mv.assets`, which the store relation supplies as NULL::jsonb — Postgres
    // propagates NULL through the -> and ->> operators, so both land as null without a special case. That is
    // the right answer for a mint: nobody is reselling it and no token has been issued yet.
    seller: r.seller ?? null,
    issuedId: r.issued_id ?? null,
    priceCredits: Number(r.price_credits),
    manaWei: r.mana_wei ?? null,
    available: r.available ? Number(r.available) : 1,
    network: isPolygon ? Network.MATIC : Network.ETHEREUM,
    chainId: isPolygon ? polygonChainId : ethereumChainId,
    createdAt: Number(r.created_at)
  }
}

// Row -> model for the item-GROUPED feeds (the browse grid and the related-items rail). Extends the shared
// per-listing mapper with the one field grouping adds. Shared for the same reason mapUnifiedRow is: the rail
// is meant to be indistinguishable from the grid, so the two must not map a row differently.
function mapUnifiedItemRow(r: RelatedItemRow, polygonChainId: number, ethereumChainId: number): UnifiedItem {
  return {
    ...mapUnifiedRow(r, polygonChainId, ethereumChainId),
    // The only field the grouped feed adds: how many rows the union produced for this item. NOTE it counts
    // store mints alongside trades, so it is "credit-buyable offers" rather than strictly "listings" — a
    // resale-only drill-down can legitimately come back empty for an item badged with a count.
    listingCount: Number(r.listing_count)
  }
}

// Rarity ranks, scarcest (0) first, sourced from @dcl/schemas so the scale can never drift from the enum.
const RARITY_RANKS: Record<string, number> = Object.fromEntries(Rarity.getRarities().map((rarity, index) => [rarity, index]))
// Sorts a row whose rarity is missing or unrecognised behind every known tier.
const UNKNOWN_RARITY_DISTANCE = Rarity.getRarities().length

// "Prioritise rarity" as a sortable distance from the anchor's tier rather than a same/different boolean.
// Rarity is an ORDERED scale, so distance degrades gracefully: exact matches lead, and when there aren't
// enough of them the next-closest tiers fill the rail instead of an arbitrary tail. Distances are computed
// in JS and bound as params, so the CASE contains no arithmetic and no interpolated input. An anchor with
// an unknown rarity yields a constant, which leaves the ordering to the tiebreakers below it.
function rarityDistanceExpr(referenceRarity: string | null): SQLStatement {
  const referenceRank = referenceRarity == null ? undefined : RARITY_RANKS[referenceRarity.toLowerCase()]
  if (referenceRank === undefined) return SQL`0`

  const expr = SQL`CASE lower(d.rarity)`
  for (const [rarity, rank] of Object.entries(RARITY_RANKS)) {
    expr.append(SQL` WHEN ${rarity} THEN ${Math.abs(rank - referenceRank)}`)
  }
  return expr.append(SQL` ELSE ${UNKNOWN_RARITY_DISTANCE} END`)
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
      .append(metadataJoins())
      .append(
        SQL`
      WHERE mv.status = 'open'
        AND (mv.available IS NULL OR mv.available > 0)
        AND EXISTS (
          SELECT 1 FROM marketplace.trade_assets ta
          WHERE ta.trade_id = mv.id AND ta.direction = 'received' AND ta.asset_type = ${USD_PEGGED_ASSET_TYPE}
        )
        AND `
      )
      .append(APPROVED_COLLECTION_PREDICATE)

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
      query.append(SQL` AND `).append(getSearchMatchWhere(SHOP_ITEM_ID_EXPRESSION, filters.search))
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
      .append(metadataJoins())
      .append(
        SQL`
      WHERE mv.status = 'open'
        AND mv.type = 'public_item_order'
        AND (mv.available IS NULL OR mv.available > 0)
        AND EXISTS (
          SELECT 1 FROM marketplace.trade_assets ta
          WHERE ta.trade_id = mv.id AND ta.direction = 'received' AND ta.asset_type = ${ERC20_ASSET_TYPE}
        )
        AND `
      )
      .append(APPROVED_COLLECTION_PREDICATE)

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
      query.append(SQL` AND `).append(getSearchMatchWhere(SHOP_ITEM_ID_EXPRESSION, filters.search))
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
      WHERE sub.usd_wei > 0 AND sub.usd_wei <= ${MAX_USD_WEI}::numeric`)

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

    const data: UnifiedListing[] = result.rows.map(r => mapUnifiedRow(r, polygonChainId, ethereumChainId))

    return { data, total }
  }

  // The item-unified BROWSE feed: the same credit-buyable universe as getUnifiedListings, but collapsed
  // to ONE row per (contract, item) by buildItemUnifiedCore. The outer query then applies the credit
  // price-range on the HEADLINE price, the display sort, and pagination, exposing COUNT(*) OVER() as the
  // total number of items.
  async function getShopItems(filters: UnifiedCatalogFilters, manaUsdRate: number): Promise<{ data: UnifiedItem[]; total: number }> {
    const first = clampCount(filters.first, SHOP_DEFAULT_PAGE_SIZE, SHOP_MIN_PAGE_SIZE, SHOP_MAX_PAGE_SIZE)
    const skip = clampCount(filters.skip, 0, 0, Number.MAX_SAFE_INTEGER)
    const rateNumericString = rateToNumericString(manaUsdRate)

    const query = SQL`
      SELECT
        d.*,
        COUNT(*) OVER() AS total
      FROM (
        `.append(buildItemUnifiedCore(filters, rateNumericString)).append(SQL`
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

    const data = result.rows.map(r => mapUnifiedItemRow(r, polygonChainId, ethereumChainId))

    return { data, total }
  }

  // The anchor item's similarity attributes. Read straight off the squid `item` row rather than passed in
  // by the caller: the PDP knows the item's identity from its URL long before it has hydrated the item's
  // rarity/category, so resolving here lets the rail be requested (and cached) on the first render.
  // Returns null when the item is unknown, which the caller reports as "nothing similar".
  async function getReferenceItem(contractAddress: string, itemId: string): Promise<ReferenceItem | null> {
    const query = SQL`
      SELECT
        item.rarity AS rarity,
        item.item_type AS item_type,
        COALESCE(item.search_wearable_category, item.search_emote_category) AS wearable_category
      FROM `
      .append(MARKETPLACE_SQUID_SCHEMA)
      .append(
        SQL`.item item
      WHERE item.collection_id = ${contractAddress.toLowerCase()}
        AND item.blockchain_id = ${itemId}::numeric
      LIMIT 1`
      )

    const result = await pg.query<ReferenceItemRow>(query)
    const row = result.rows[0]
    if (!row) return null

    return {
      category: topLevelCategory(row.item_type),
      wearableCategory: row.wearable_category,
      rarity: row.rarity
    }
  }

  // Items SIMILAR to one item -- the fallback rail the PDP shows when the item's own collection has
  // nothing else to offer.
  //
  // "Similar" is deliberately narrow for v1: SAME top-level category (wearable/emote) and, when the anchor
  // has one, the SAME on-chain sub-category (hat, upper_body, dance, ...). Sub-category is the hard filter
  // because "another wearable" is too broad to read as similar, while "another hat" does. Rarity is NOT a
  // filter -- it only steers the ORDER, closest tier first (see rarityDistanceExpr), so a one-of-a-kind
  // rarity still fills a full rail instead of returning two cards.
  //
  // Runs as two statements on purpose: the anchor lookup first, then the feed query built from the SAME
  // shared browse-filter/grouping blocks as /v3/catalog/unified?groupBy=item. Folding the lookup into one
  // statement would mean re-expressing those filters as SQL-side joins on the anchor row -- a second,
  // divergent copy of logic the rest of this port already owns, to save a single-row indexed read.
  async function getRelatedItems(filters: RelatedItemsFilters, manaUsdRate: number): Promise<{ data: UnifiedItem[] }> {
    const { contractAddress, itemId } = filters
    const first = clampCount(filters.first, RELATED_DEFAULT_LIMIT, SHOP_MIN_PAGE_SIZE, RELATED_MAX_LIMIT)
    const rateNumericString = rateToNumericString(manaUsdRate)

    const reference = await getReferenceItem(contractAddress, itemId)
    if (!reference) return { data: [] }

    const core = buildItemUnifiedCore(
      {
        category: reference.category,
        wearableCategories: reference.wearableCategory ? [reference.wearableCategory] : undefined
      },
      rateNumericString
    )

    const query = SQL`
      SELECT d.*
      FROM (
        `.append(core).append(SQL`
      ) d
      WHERE d.usd_wei > 0`)

    // Drop the anchor itself. Written as a disjunction (not `NOT (a AND b)`) because item_id is nullable:
    // a NULL item_id would make the negated form evaluate to NULL and silently discard the row.
    query.append(SQL` AND (d.contract_address <> ${contractAddress.toLowerCase()} OR COALESCE(d.item_id, '') <> ${itemId})`)

    // Rarity first (closest tier to the anchor), then newest, then trade_id so the rail is deterministic.
    query
      .append(SQL` ORDER BY `)
      .append(rarityDistanceExpr(reference.rarity))
      .append(SQL`, d.created_at DESC, d.trade_id LIMIT ${first}`)

    const result = await pg.query<RelatedItemRow>(query)
    const polygonChainId = getPolygonChainId()
    const ethereumChainId = getEthereumChainId()

    return { data: result.rows.map(r => mapUnifiedItemRow(r, polygonChainId, ethereumChainId)) }
  }

  /**
   * The TRENDING rail: what is selling right now, restricted to what the Shop can actually sell.
   *
   * Ranking (the marketplace's own composition, made deterministic):
   *   - `sales_window` counts every sale of each item inside the look-back window and sums what those sales
   *     were actually paid at. Both signals matter -- see TRENDING_SALES_CUT.
   *   - the first 60% of the slots go to the highest sale COUNT; the remaining 40% to the highest VOLUME
   *     among the items the first pass did not already take.
   *   - the rows come back IN that order. The marketplace shuffles its equivalent before returning it, which
   *     throws the ranking away: the row shows a trending SET in arbitrary order.
   *
   * Two deliberate asymmetries:
   *
   * The SIGNAL is broader than the ROW. `sale` counts mints and resales, primary and secondary, MANA-priced
   * and credit-priced -- demand for an item is demand however it was met. What the row may DISPLAY is then
   * narrowed by the shared item-unified core plus the caller's filters, so an item that is trending purely on
   * resales but has no credit-buyable listing is simply absent rather than shown unbuyable.
   *
   * `volume` is the sum of the PRICES THOSE SALES SETTLED AT, not the item's current price times its sale
   * count. The latter (what /v1/trendings computes) re-prices history with a number that can have changed
   * since: a creator who cuts their price rewrites their own past volume.
   *
   * Unpaginated and ordered by a TOTAL order -- `(contract_address, item_id)` is unique out of the core's
   * DISTINCT ON, so no two rows can compare equal and the LIMIT cannot drop or duplicate a row.
   */
  async function getTrendingItems(filters: TrendingItemsFilters, manaUsdRate: number): Promise<{ data: TrendingItem[] }> {
    const first = clampCount(filters.first, TRENDING_DEFAULT_LIMIT, SHOP_MIN_PAGE_SIZE, TRENDING_MAX_LIMIT)
    const days = clampCount(filters.days, TRENDING_DEFAULT_DAYS, TRENDING_MIN_DAYS, TRENDING_MAX_DAYS)
    const rateNumericString = rateToNumericString(manaUsdRate)

    // Slot split, ceil + remainder rather than the marketplace's two fractional `Array.slice` calls: those
    // truncate independently, so a 12-slot rail asks for slice(0, 7.2) + slice(0, 4.8) and returns 11 rows
    // even with plenty of supply. This always adds up to `first`.
    const salesSlots = Math.ceil(first * TRENDING_SALES_CUT)
    const volumeSlots = first - salesSlots

    // `sale.timestamp` is stored in SECONDS. Same window helper the marketplace's trending row uses, so the
    // two rows are computed over the same slice of history rather than over two similar-looking ones.
    const fromSeconds = Math.floor(getDateXDaysAgo(days).getTime() / 1000)

    const query = SQL`
      WITH sales_window AS (
        SELECT
          sale.search_contract_address AS contract_address,
          sale.search_item_id::text AS item_id,
          COUNT(*)::int AS sales,
          SUM(sale.price::numeric) AS volume
        FROM `
      .append(MARKETPLACE_SQUID_SCHEMA)
      .append(
        SQL`.sale sale
        WHERE sale.timestamp > ${fromSeconds}
          -- A sale with no item identity cannot be attributed to an item, so it cannot be ranked. The
          -- marketplace drops these too (its reducer skips falsy itemIds); doing it in SQL means they never
          -- reach the join instead of being counted and then discarded.
          AND sale.search_item_id IS NOT NULL
        GROUP BY 1, 2
      ),
      listed AS (
        SELECT d.*, w.sales, w.volume
        FROM (
          `
      )
      .append(buildItemUnifiedCore(filters, rateNumericString)).append(SQL`
        ) d
        JOIN sales_window w ON w.contract_address = d.contract_address AND w.item_id = d.item_id
        WHERE d.usd_wei > 0
      ),
      ranked AS (
        SELECT
          listed.*,
          ROW_NUMBER() OVER (
            ORDER BY listed.sales DESC, listed.volume DESC, listed.contract_address, listed.item_id
          ) AS sales_rank
        FROM listed
      ),
      composed AS (
        SELECT
          ranked.*,
          (ranked.sales_rank <= ${salesSlots}) AS by_sales,
          -- Ranked by volume WITHIN each half of the sales split, so the fill pass ranks exactly the items
          -- the sales pass left behind. Partitioning on the same predicate is what keeps the two passes from
          -- needing a second scan to subtract one from the other.
          ROW_NUMBER() OVER (
            PARTITION BY (ranked.sales_rank <= ${salesSlots})
            ORDER BY ranked.volume DESC, ranked.sales DESC, ranked.contract_address, ranked.item_id
          ) AS volume_rank
        FROM ranked
      )
      SELECT *
      FROM composed
      WHERE by_sales OR volume_rank <= ${volumeSlots}
      -- Sales block first (booleans sort false < true, so DESC puts the block ahead), each block in its own
      -- rank order, then the unique item key so the order is total.
      ORDER BY by_sales DESC, (CASE WHEN by_sales THEN sales_rank ELSE volume_rank END), contract_address, item_id
      LIMIT ${first}`)

    const result = await pg.query<TrendingItemRow>(query)
    const polygonChainId = getPolygonChainId()
    const ethereumChainId = getEthereumChainId()

    return {
      data: result.rows.map(r => ({ ...mapUnifiedItemRow(r, polygonChainId, ethereumChainId), trendingSales: Number(r.sales) }))
    }
  }

  /**
   * Creators ranked by how much MANA THEIR items took in the window.
   *
   * Attribution is by `item.creator`, not by who executed the sale — see TopCreator on why the account
   * day data the marketplace's own ranking reads cannot answer this for a primary-sales shop, and on why
   * the ranking is revenue rather than the unit count this used to order by.
   *
   * Ranked here, filtered by the caller: who is presentable (a claimed name, no duplicates) needs the
   * Catalyst, which this service does not talk to. So the rail asks for more rows than it shows and
   * makes that call itself.
   */
  async function getTopCreators(filters: TopCreatorsFilters): Promise<{ data: TopCreator[] }> {
    const first = clampCount(filters.first, TOP_CREATORS_DEFAULT_LIMIT, 1, TOP_CREATORS_MAX_LIMIT)
    const days = clampCount(filters.days, TOP_CREATORS_DEFAULT_DAYS, TOP_CREATORS_MIN_DAYS, TOP_CREATORS_MAX_DAYS)
    // `sale.timestamp` is stored in SECONDS. Same window helper the trending rail uses, so the two rows
    // are computed over the same slice of history rather than over two similar-looking ones.
    const fromSeconds = Math.floor(getDateXDaysAgo(days).getTime() / 1000)
    // The sales floor is a RATE, so a caller who narrows the window gets a proportionally easier bar
    // rather than an empty row — see the constant. Rounded, then held above the absolute floor.
    const minSales = Math.max(
      TOP_CREATORS_MIN_WINDOW_SALES_FLOOR,
      Math.round((days / TOP_CREATORS_DEFAULT_DAYS) * TOP_CREATORS_MIN_SALES_PER_WINDOW)
    )

    // Two aggregates over the same creators, joined once. `ranked` sums the windowed REVENUE that orders
    // the row and counts the sales behind it, plus the unwindowed count the row displays; `catalogue`
    // counts what they have PUBLISHED, which lives in `item` and so cannot come from the same GROUP BY
    // without multiplying rows by their sales.
    //
    // The window is a FILTER rather than a WHERE so all three come out of one pass: putting it in the
    // WHERE would make the all-time total a count of the last 30 days too.
    const query = SQL`
      WITH ranked AS (
        SELECT item.creator AS creator,
               -- Kept NUMERIC here and cast only on the way out: ordering the text would sort 900 above
               -- 1000. Prices are raw MANA wei, so the sum overflows anything narrower.
               COALESCE(SUM(sale.price::numeric) FILTER (WHERE sale.timestamp > ${fromSeconds}), 0) AS volume,
               COUNT(*) FILTER (WHERE sale.timestamp > ${fromSeconds})::int AS sales,
               COUNT(*)::int AS total_sales
        FROM `
      .append(MARKETPLACE_SQUID_SCHEMA)
      .append(
        SQL`.sale sale
        JOIN `
      )
      .append(MARKETPLACE_SQUID_SCHEMA)
      .append(
        SQL`.item item ON item.id = sale.item_id
        WHERE sale.item_id IS NOT NULL
          -- Unapproved collections are not browsable, so their creators are not introducible either.
          AND item.search_is_collection_approved = true
        GROUP BY item.creator
      ), catalogue AS (
        SELECT creator, COUNT(*)::int AS items, COUNT(DISTINCT collection_id)::int AS collections
        FROM `
      )
      .append(MARKETPLACE_SQUID_SCHEMA)
      .append(
        SQL`.item
        WHERE search_is_collection_approved = true
        GROUP BY creator
      )
      SELECT r.creator, r.volume::text AS volume, r.sales, r.total_sales,
             COALESCE(c.collections, 0) AS collections, COALESCE(c.items, 0) AS items
      FROM ranked r
      LEFT JOIN catalogue c ON c.creator = r.creator
      -- A creator who traded barely at all in the window is not "top" anything, however much they have
      -- published; one with almost nothing published is not worth browsing, however well the month went.
      -- The sales floor is what stops a single expensive sale from winning a revenue ranking outright.
      WHERE r.sales >= ${minSales}
        AND COALESCE(c.items, 0) >= ${TOP_CREATORS_MIN_ITEMS}
      ORDER BY r.volume DESC, r.creator ASC
      LIMIT ${first}`
      )

    const result = await pg.query<TopCreatorRow>(query)
    return {
      data: result.rows.map(row => ({
        id: row.creator,
        // Already text off the query — kept as a string all the way out, never widened to `number`.
        volumeWei: String(row.volume),
        sales: Number(row.sales),
        totalSales: Number(row.total_sales),
        collections: Number(row.collections),
        items: Number(row.items)
      }))
    }
  }

  return {
    getShopListings,
    getImportableListings,
    getLegacyListings,
    getUnifiedListings,
    getShopItems,
    getRelatedItems,
    getTrendingItems,
    getTopCreators
  }
}
