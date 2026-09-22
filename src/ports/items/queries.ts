import SQL, { SQLStatement } from 'sql-template-strings'
import { EmotePlayMode, GenderFilterOption, ItemFilters, ListingStatus, TradeAssetType, TradeType, WearableGender } from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import {
  applySearchLevel,
  getRelevanceOrderBy,
  getSearchCteDefinitions,
  getSearchMatchJoin,
  getSearchMatchWhere,
  getSearchScoreColumns,
  resolveShopSortBy,
  SEARCH_LEVEL_ALIAS
} from '../../logic/catalog/search-match'
import { getDBNetworks } from '../../utils'
import { getTradesCTE } from '../catalog/queries'
import { ShopSortBy } from '../shop-catalog/types'
import { getWhereStatementFromFilters } from '../utils'
import { ItemQueryFilters, ItemType } from './types'
import { DEFAULT_LIMIT, getItemTypesFromNFTCategory } from './utils'

export function getItemById(itemId: string) {
  return SQL`
        SELECT id
        FROM `.append(MARKETPLACE_SQUID_SCHEMA).append(SQL`.item
        WHERE id = ${itemId};
      `)
}

function getItemsLimitAndOffsetStatement(filters: Pick<ItemFilters, 'first' | 'skip'>) {
  const limit = filters?.first ? filters.first : DEFAULT_LIMIT
  const offset = filters?.skip ? filters.skip : 0

  return SQL` LIMIT ${limit} OFFSET ${offset} `
}

function getGenderWhereStatement(isEmote: boolean, genders?: (WearableGender | GenderFilterOption)[]): SQLStatement | null {
  if (!genders || !genders.length) {
    return null
  }

  const hasUnisex = genders.includes(GenderFilterOption.UNISEX)
  const hasMale = hasUnisex || genders.includes(GenderFilterOption.MALE)
  const hasFemale = hasUnisex || genders.includes(GenderFilterOption.FEMALE)
  const bodyShapesArray = []

  if (hasMale) {
    bodyShapesArray.push('BaseMale')
  }

  if (hasFemale) {
    bodyShapesArray.push('BaseFemale')
  }

  if (isEmote) {
    return bodyShapesArray.length ? SQL` item.search_emote_body_shapes @> ${bodyShapesArray} ` : null
  }

  return bodyShapesArray.length ? SQL` item.search_wearable_body_shapes @> ${bodyShapesArray} ` : null
}

function getEmotePlayModeWhereStatement(emotePlayMode: EmotePlayMode | EmotePlayMode[] | undefined): SQLStatement | null {
  if (!emotePlayMode || (Array.isArray(emotePlayMode) && (emotePlayMode.length === 2 || emotePlayMode.length === 0))) {
    return null
  }

  if (emotePlayMode === EmotePlayMode.LOOP || (Array.isArray(emotePlayMode) && emotePlayMode.includes(EmotePlayMode.LOOP))) {
    return SQL` item.search_emote_loop = true `
  }

  return SQL` item.search_emote_loop = false `
}

// "Buyable right now": primary liquidity only -- an open v3 item order or the classic store minter,
// with stock left. Built fresh per call because a SQLStatement carries its own bound parameters and
// cannot be reused across the positive and negated branches.
function getIsOnSalePredicate(): SQLStatement {
  return SQL` (((unified_trades.id IS NOT NULL AND item.search_is_marketplace_v3_minter = true) OR item.search_is_store_minter = true) AND item.available > 0) `
}

// Item name as the other shop feeds resolve it (/v3/catalog/unified, /v3/catalog/shop) -- the
// wearable's or the emote's, whichever the metadata join produced.
const ITEM_NAME_EXPRESSION = 'COALESCE(wearable.name, emote.name)'
const ITEM_ID_EXPRESSION = 'item.id::text'

function getItemNameExpression(): SQLStatement {
  return SQL``.append(` ${ITEM_NAME_EXPRESSION} `)
}

// Sorting is NOT this builder's job, and the `TODO: Add sort by logic` that used to sit here read as if
// nothing sorted at all. /v3/catalog/items sorts through getCatalogItemsOrderByStatement below.
// /v1/items (getItemsQuery) still emits no ORDER BY, which is a real paging hazard there — LIMIT/OFFSET
// over an unordered plan can repeat or drop a row between pages — but the fix belongs in that query, not
// in the WHERE clause both feeds share.
function getItemsWhereStatement(
  filters: ItemQueryFilters,
  rateNumericString = '0',
  { onlyApprovedCollections = false }: { onlyApprovedCollections?: boolean } = {}
): SQLStatement {
  if (!filters) {
    return SQL``
  }

  // The browse feed mirrors the base WHERE /v2/catalog applies: an item whose collection curation did
  // not approve does not belong in a storefront. Scoped to browse on purpose -- /v1/items is also how a
  // single item is fetched by id, and making those 404 is a different decision from not listing them.
  // NOTE `= true` rather than `IS NOT FALSE`: the flag is NULL for most unapproved items (a squid
  // denormalization quirk), and every one of those belongs to a collection with is_approved = false.
  const FILTER_BY_APPROVED_COLLECTION = onlyApprovedCollections ? SQL` item.search_is_collection_approved = true ` : null
  const FILTER_BY_CATEGORY = filters.category ? SQL` LOWER(item.item_type) = ANY (${getItemTypesFromNFTCategory(filters.category)}) ` : null
  const creators = filters.creator && (Array.isArray(filters.creator) ? filters.creator : [filters.creator])
  const FILTER_BY_CREATOR =
    creators && creators.length ? SQL` LOWER(item.creator) = ANY(${creators.map(creator => creator.toLowerCase())}) ` : null
  const FITLER_BY_RARITY = filters.rarities && filters.rarities.length ? SQL` item.rarity = ANY (${filters.rarities}) ` : null
  const FILTER_BY_SOLD_OUT = filters.isSoldOut ? SQL` item.available = 0 ` : null
  // isOnSale=false is a real filter, not a no-op: it must return the complement of isOnSale=true so
  // "All" is always a superset of "On sale" and "Not for sale" is the difference. `available` and the
  // minter flags are NOT NULL, so the negation is two-valued and needs no NULL guard.
  const FILTER_BY_IS_ON_SALE =
    filters.isOnSale === undefined ? null : filters.isOnSale ? getIsOnSalePredicate() : SQL` NOT `.append(getIsOnSalePredicate())
  // Word-level match over the item's name plus its tags -- the same rule /v3/catalog/unified and
  // /v3/catalog/shop apply, so every shop surface agrees on what a query matches. See
  // getSearchMatchWhere for why the previous `name ILIKE '%q%'` had to go.
  const FILTER_BY_TEXT = filters.search ? getSearchMatchWhere(ITEM_ID_EXPRESSION, filters.search) : null
  const FILTER_BY_WEARABLE_HEAD = filters.isWearableHead ? SQL` item.search_is_wearable_head = true ` : null
  const FILTER_BY_WEARABLE_ACCESSORY = filters.isWearableAccessory ? SQL` item.search_is_wearable_accessory = true ` : null
  const FILTER_BY_WEARABLE_SMART = filters.isWearableSmart ? SQL` item.item_type = ${ItemType.SMART_WEARABLE_V1} ` : null
  const FILTER_BY_WEARABLE_CATEGORY = filters.wearableCategory ? SQL` wearable.category = ${filters.wearableCategory} ` : null
  const FILTER_BY_WEARABLE_GENDER = getGenderWhereStatement(false, filters.wearableGenders)
  const FILTER_BY_EMOTE_CATEGORY = filters.emoteCategory ? SQL` emote.category = ${filters.emoteCategory} ` : null
  const FILTER_BY_EMOTE_GENDERS = getGenderWhereStatement(true, filters.emoteGenders)
  const FILTER_BY_EMOTE_PLAY_MODE = getEmotePlayModeWhereStatement(filters.emotePlayMode)
  const FILTER_BY_CONTRACT_ADDRESS =
    filters.contractAddresses && filters.contractAddresses.length ? SQL` item.collection_id = ANY (${filters.contractAddresses}) ` : null
  const FILTER_BY_ITEM_ID = filters.itemId ? SQL` item.blockchain_id = ${filters.itemId} ` : null
  const FILTER_BY_ID = filters.ids && filters.ids.length ? SQL` item.id = ANY (${filters.ids}) ` : null
  const FILTER_BY_NETWORK = filters.network ? SQL` item.network = ANY (${getDBNetworks(filters.network)}) ` : null
  const FILTER_BY_MIN_PRICE = filters.minPrice
    ? SQL` ((item.search_is_store_minter = true AND item.price >= ${filters.minPrice}) OR (item.search_is_marketplace_v3_minter = true AND unified_trades.assets -> 'received' ->> 'amount')::numeric(78) >= ${filters.minPrice}) `
    : null
  const FILTER_BY_MAX_PRICE = filters.maxPrice
    ? SQL` ((item.search_is_store_minter = true AND item.price <= ${filters.maxPrice}) OR (item.search_is_marketplace_v3_minter = true AND unified_trades.assets -> 'received' ->> 'amount')::numeric(78) <= ${filters.maxPrice}) `
    : null
  // Credit-denominated price range (the Shop's own unit), as opposed to the MANA-wei minPrice/maxPrice
  // above. NULLIF drops not-for-sale items (their credit price is 0) out of BOTH bounds: asking for
  // "at most 5 credits" must not surface items that carry no price at all. Only /v3/catalog/items parses
  // these params, so /v1/items never reaches this branch.
  const FILTER_BY_MIN_PRICE_CREDITS =
    filters.minPriceCredits != null
      ? SQL` NULLIF(`.append(priceCreditsExpr(rateNumericString)).append(SQL`, 0) >= ${filters.minPriceCredits} `)
      : null
  const FILTER_BY_MAX_PRICE_CREDITS =
    filters.maxPriceCredits != null
      ? SQL` NULLIF(`.append(priceCreditsExpr(rateNumericString)).append(SQL`, 0) <= ${filters.maxPriceCredits} `)
      : null
  const FILTER_BY_HAS_SOUND = filters.emoteHasSound ? SQL` emote.has_sound = true ` : null
  const FILTER_BY_HAS_GEOMETRY = filters.emoteHasGeometry ? SQL` emote.has_geometry = true ` : null
  // For now, let's filter if the outcome type is not null
  const FILTER_BY_OUTCOME_TYPE = filters.emoteOutcomeType ? SQL` emote.outcome_type IS NOT NULL ` : null
  const FILTER_BY_URNS = filters.urns && filters.urns.length ? SQL` item.urn = ANY (${filters.urns}) ` : null
  // Social emotes (those with an outcome type) are included by default; excluded only when includeSocialEmotes=false.
  // Note: passing emoteOutcomeType together with includeSocialEmotes=false is contradictory and returns no emotes.
  const EXCLUDE_SOCIAL_EMOTES = filters.includeSocialEmotes === false ? SQL` emote.outcome_type IS NULL ` : null
  return getWhereStatementFromFilters([
    FILTER_BY_APPROVED_COLLECTION,
    FILTER_BY_CATEGORY,
    FILTER_BY_CREATOR,
    FITLER_BY_RARITY,
    FILTER_BY_SOLD_OUT,
    FILTER_BY_IS_ON_SALE,
    FILTER_BY_TEXT,
    FILTER_BY_WEARABLE_HEAD,
    FILTER_BY_WEARABLE_ACCESSORY,
    FILTER_BY_WEARABLE_SMART,
    FILTER_BY_WEARABLE_CATEGORY,
    FILTER_BY_WEARABLE_GENDER,
    FILTER_BY_EMOTE_CATEGORY,
    FILTER_BY_EMOTE_GENDERS,
    FILTER_BY_EMOTE_PLAY_MODE,
    FILTER_BY_CONTRACT_ADDRESS,
    FILTER_BY_ITEM_ID,
    FILTER_BY_ID,
    FILTER_BY_NETWORK,
    FILTER_BY_MIN_PRICE,
    FILTER_BY_MAX_PRICE,
    FILTER_BY_MIN_PRICE_CREDITS,
    FILTER_BY_MAX_PRICE_CREDITS,
    FILTER_BY_HAS_SOUND,
    FILTER_BY_HAS_GEOMETRY,
    FILTER_BY_OUTCOME_TYPE,
    FILTER_BY_URNS,
    EXCLUDE_SOCIAL_EMOTES
  ])
}

// The trades CTE is named apart from its join alias: the LATERAL below emits `unified_trades` (the name
// all the SELECT expressions and shared helpers already use), so the CTE it reads from needs its own.
const ITEM_TRADES_CTE = 'item_trades'

export function getItemsQuery(filters: ItemQueryFilters = {}) {
  /**
   * The trades CTE is deliberately NOT narrowed by `category`, and the join below picks exactly one trade.
   *
   * CATEGORY: this feed joins only `public_item_order` trades, and in `mv_trades` an item order carries
   * `sent_nft_category = NULL` — that column is populated from the NFT join, which an item order does not
   * have. `sent_nft_category = 'wearable'` is therefore never true for the rows this query needs, so
   * passing the filter through dropped EVERY primary listing: an item on sale came back with no trade, no
   * price and isOnSale false whenever the caller asked for a category. Category is already applied to the
   * items themselves by FILTER_BY_CATEGORY (item.item_type), which is the authoritative filter here.
   *
   * ONE TRADE: an item can have more than one OPEN item order (5 items do in production), and a plain join
   * would then emit that item twice — duplicate tiles, an inflated `COUNT(*) OVER()` total, and a price
   * taken from whichever row the planner happened to return. The LATERAL below picks the same one
   * `/v2/catalog` does (its `MAX(id::text)`, see getTradesJoin in ports/catalog/queries), so the two feeds
   * cannot quote different prices for the same item.
   */
  // With a search the count is taken above the level filter (see applySearchLevel), not here.
  const core = SQL`
    SELECT
      `
    .append(filters.search ? SQL`` : SQL`COUNT(*) OVER() as count,`)
    .append(
      SQL`
      item.id,
      item.image,
      item.uri,
      item.blockchain_id as item_id,
      item.collection_id as contract_address,
      coalesce(wearable.rarity, emote.rarity) as rarity,
      item.price,
      item.available,
      item.creator,
      item.beneficiary,
      item.created_at,
      item.updated_at,
      item.reviewed_at,
      item.sold_at,
      item.urn,
      item.network,
      item.search_is_store_minter,
      item.search_is_marketplace_v3_minter,
      unified_trades.id as trade_id,
	    coalesce(wearable.name, emote.name) as name,
      wearable.body_shapes as wearable_body_shapes,
      emote.body_shapes as emote_body_shapes,
      wearable.category as wearable_category,
      emote.category as emote_category,
      item.item_type,
      emote.loop,
      emote.has_sound,
      emote.has_geometry,
      emote.outcome_type as emote_outcome_type,
      coalesce (wearable.description, emote.description) as description,
      coalesce (to_timestamp(item.first_listed_at) AT TIME ZONE 'UTC', unified_trades.created_at) as first_listed_at,
      unified_trades.assets -> 'received' ->> 'beneficiary' as trade_beneficiary,
      unified_trades.expires_at as trade_expires_at,
      unified_trades.trade_contract as trade_contract,
      unified_trades.assets -> 'received' ->> 'amount' as trade_price`
    )
    .append(filters.search ? SQL`, `.append(getSearchScoreColumns()) : SQL``)
    .append(
      SQL`
    FROM
      `
    )
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.item item
    LEFT JOIN `
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`.metadata metadata on
      item.metadata_id = metadata.id
    LEFT JOIN `
            .append(MARKETPLACE_SQUID_SCHEMA)
            .append(
              SQL`.wearable wearable on
      metadata.wearable_id = wearable.id
    LEFT JOIN `
                .append(MARKETPLACE_SQUID_SCHEMA)
                .append(
                  SQL`.emote emote on
      metadata.emote_id = emote.id
  `
                    .append(
                      ` LEFT JOIN LATERAL (
            SELECT * FROM ${ITEM_TRADES_CTE}
            WHERE sent_item_id = item.blockchain_id::text
              AND sent_contract_address = item.collection_id
              AND type = '${TradeType.PUBLIC_ITEM_ORDER}'
              AND status = '${ListingStatus.OPEN}'
            ORDER BY id::text DESC
            LIMIT 1
          ) unified_trades ON TRUE `
                    )
                    .append(filters.search ? getSearchMatchJoin(ITEM_ID_EXPRESSION) : SQL``)
                    .append(getItemsWhereStatement(filters))
                )
            )
        )
    )

  // This feed emits no ORDER BY of its own. A search adds one: with the rows ranked, an unordered page would
  // hand back the ranking in whatever order the plan produced it, and a LIMIT/OFFSET over that is not paging.
  return getTradesCTE({ cteName: ITEM_TRADES_CTE })
    .append(filters.search ? SQL`, `.append(getSearchCteDefinitions(filters.search)) : SQL``)
    .append(
      filters.search
        ? applySearchLevel(core, 'count').append(
            getRelevanceOrderBy(SEARCH_LEVEL_ALIAS, `${SEARCH_LEVEL_ALIAS}.created_at DESC, ${SEARCH_LEVEL_ALIAS}.id ASC`)
          )
        : core
    )
    .append(getItemsLimitAndOffsetStatement(filters))
}

// 1 credit = $0.10; $1 = 1e18 USD wei = 10 credits, so 1 credit = 1e17 USD wei. Kept as a literal
// string so the SQL numeric math stays exact (no float precision loss).
const USD_WEI_PER_CREDIT = '100000000000000000'

// The asset-type-aware whole-credit price of an item. Unlike the mixed-unit `/v1/items` `price`, this
// normalizes every item to whole credits, CEIL-consistent with the native Shop path ("Model B"):
//   - a v3 trade priced in USD-pegged MANA (asset_type = USD_PEGGED_MANA) is already USD wei -> no rate;
//   - a v3 trade priced in classic MANA/ERC20, or a classic store-minter `item.price` (MANA wei), is
//     multiplied by the MANA/USD rate to reach USD wei;
//   - anything not currently for sale (available = 0, no open minter) -> 0.
// The trade branch mirrors fromDBItemToItem's precedence (open v3 trade wins over the store minter).
// Returned as a bare expression (not the aliased column) because WHERE and ORDER BY cannot reference a
// SELECT alias inside an expression, so the credit range filter and the credit sorts re-derive it.
function priceCreditsExpr(rateNumericString: string): SQLStatement {
  return SQL`
      CASE
        WHEN item.available > 0 AND unified_trades.id IS NOT NULL AND item.search_is_marketplace_v3_minter = true THEN
          CASE
            WHEN EXISTS (
              SELECT 1 FROM marketplace.trade_assets ta
              WHERE ta.trade_id = unified_trades.id
                AND ta.direction = 'received'
                AND ta.asset_type = ${TradeAssetType.USD_PEGGED_MANA}
            )
            THEN CEIL((unified_trades.assets -> 'received' ->> 'amount')::numeric / ${USD_WEI_PER_CREDIT}::numeric)
            ELSE CEIL((unified_trades.assets -> 'received' ->> 'amount')::numeric * ${rateNumericString}::numeric / ${USD_WEI_PER_CREDIT}::numeric)
          END
        WHEN item.available > 0 AND item.search_is_store_minter = true THEN
          CEIL(item.price::numeric * ${rateNumericString}::numeric / ${USD_WEI_PER_CREDIT}::numeric)
        ELSE 0
      END`
}

function getPriceCreditsSelect(rateNumericString: string): SQLStatement {
  return priceCreditsExpr(rateNumericString).append(SQL`::bigint AS price_credits`)
}

// Ordering for the catalog-items feed. A deterministic order is not cosmetic here: the feed is paged
// with LIMIT/OFFSET, and without ORDER BY Postgres may return a row on two pages (or none) as the plan
// shifts, so an infinite-scroll grid duplicates and drops items. `item.id` breaks ties so equal keys
// (same creation block, same price, same name) page stably. Fixed expressions only — user input never
// reaches ORDER BY.
//
// With a search the keys are read off the level-filtered relation's OUTPUT columns (`price_credits`,
// `name`, `created_at`, `id`): the same order the source expressions give, spelled where the wrapper can
// see it.
function getCatalogItemsOrderByStatement(rateNumericString: string, sortBy: ShopSortBy, searching: boolean): SQLStatement {
  if (searching) {
    const f = SEARCH_LEVEL_ALIAS
    switch (sortBy) {
      case 'cheapest':
        return SQL``.append(` ORDER BY NULLIF(${f}.price_credits, 0) ASC NULLS LAST, ${f}.id ASC `)
      case 'most_expensive':
        return SQL``.append(` ORDER BY ${f}.price_credits DESC, ${f}.id ASC `)
      case 'name':
        return SQL``.append(` ORDER BY ${f}.name ASC, ${f}.id ASC `)
      case 'relevance':
        return getRelevanceOrderBy(f, `${f}.created_at DESC, ${f}.id ASC`)
      case 'newest':
      default:
        return SQL``.append(` ORDER BY ${f}.created_at DESC, ${f}.id ASC `)
    }
  }
  switch (sortBy) {
    // Not-for-sale items price at 0 credits, which would otherwise head the cheapest list; NULLIF sends
    // them to the end, where "cheapest" means cheapest thing you can actually buy.
    case 'cheapest':
      return SQL` ORDER BY NULLIF(`.append(priceCreditsExpr(rateNumericString)).append(SQL`, 0) ASC NULLS LAST, item.id ASC `)
    case 'most_expensive':
      return SQL` ORDER BY `.append(priceCreditsExpr(rateNumericString)).append(SQL` DESC, item.id ASC `)
    case 'name':
      return SQL` ORDER BY `.append(getItemNameExpression()).append(SQL` ASC, item.id ASC `)
    // Listed rather than left to fall through, so naming 'newest' makes the mapping readable without
    // checking the type to see what is missing. `relevance` cannot reach here: without a search
    // resolveShopSortBy has already turned it into `newest`.
    case 'newest':
    default:
      return SQL` ORDER BY item.created_at DESC, item.id ASC `
  }
}

// The credit-aware catalog-items feed backing GET /v3/catalog/items. Same data source and full-catalog
// semantics as getItemsQuery (ALL items incl. not-on-sale, keyed by item, filterable by creator/contract
// address/category/rarity/search) but with a server-computed, asset-type-aware `price_credits` per item,
// a credit-denominated price range and a sort. Mirrors getItemsQuery's SELECT/joins so the row maps
// through fromDBItemToItem unchanged, plus the one extra column. `rateNumericString` is the MANA/USD rate
// as a fixed-precision numeric literal.
export function getCatalogItemsQuery(filters: ItemQueryFilters = {}, rateNumericString = '0') {
  const sortBy = resolveShopSortBy(filters.sortBy, filters.search)

  // With a search the count is taken above the level filter (see applySearchLevel), not here.
  const core = SQL`
    SELECT
      `
    .append(filters.search ? SQL`` : SQL`COUNT(*) OVER() as count,`)
    .append(
      SQL`
      item.id,
      item.image,
      item.uri,
      item.blockchain_id as item_id,
      item.collection_id as contract_address,
      coalesce(wearable.rarity, emote.rarity) as rarity,
      item.price,
      item.available,
      item.creator,
      item.beneficiary,
      item.created_at,
      item.updated_at,
      item.reviewed_at,
      item.sold_at,
      item.urn,
      item.network,
      item.search_is_store_minter,
      item.search_is_marketplace_v3_minter,
      unified_trades.id as trade_id,
	    coalesce(wearable.name, emote.name) as name,
      wearable.body_shapes as wearable_body_shapes,
      emote.body_shapes as emote_body_shapes,
      wearable.category as wearable_category,
      emote.category as emote_category,
      item.item_type,
      emote.loop,
      emote.has_sound,
      emote.has_geometry,
      emote.outcome_type as emote_outcome_type,
      coalesce (wearable.description, emote.description) as description,
      coalesce (to_timestamp(item.first_listed_at) AT TIME ZONE 'UTC', unified_trades.created_at) as first_listed_at,
      unified_trades.assets -> 'received' ->> 'beneficiary' as trade_beneficiary,
      unified_trades.expires_at as trade_expires_at,
      unified_trades.trade_contract as trade_contract,
      unified_trades.assets -> 'received' ->> 'amount' as trade_price,`
    )
    .append(getPriceCreditsSelect(rateNumericString))
    .append(filters.search ? SQL`, `.append(getSearchScoreColumns()) : SQL``)
    .append(
      SQL`
    FROM
      `
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`.item item
    LEFT JOIN `
            .append(MARKETPLACE_SQUID_SCHEMA)
            .append(
              SQL`.metadata metadata on
      item.metadata_id = metadata.id
    LEFT JOIN `
                .append(MARKETPLACE_SQUID_SCHEMA)
                .append(
                  SQL`.wearable wearable on
      metadata.wearable_id = wearable.id
    LEFT JOIN `
                    .append(MARKETPLACE_SQUID_SCHEMA)
                    .append(
                      SQL`.emote emote on
      metadata.emote_id = emote.id
  `
                        .append(
                          ` LEFT JOIN LATERAL (
            SELECT * FROM ${ITEM_TRADES_CTE}
            WHERE sent_item_id = item.blockchain_id::text
              AND sent_contract_address = item.collection_id
              AND type = '${TradeType.PUBLIC_ITEM_ORDER}'
              AND status = '${ListingStatus.OPEN}'
            ORDER BY id::text DESC
            LIMIT 1
          ) unified_trades ON TRUE `
                        )
                        .append(filters.search ? getSearchMatchJoin(ITEM_ID_EXPRESSION) : SQL``)
                        .append(getItemsWhereStatement(filters, rateNumericString, { onlyApprovedCollections: true }))
                    )
                )
            )
        )
    )

  // Same two rules as getItemsQuery above: no `category` on the trades CTE, and one trade per item.
  return getTradesCTE({ cteName: ITEM_TRADES_CTE })
    .append(filters.search ? SQL`, `.append(getSearchCteDefinitions(filters.search)) : SQL``)
    .append(filters.search ? applySearchLevel(core, 'count') : core)
    .append(getCatalogItemsOrderByStatement(rateNumericString, sortBy, !!filters.search))
    .append(getItemsLimitAndOffsetStatement(filters))
}

export function getUtilityByItem(contractAddress: string, itemId: string) {
  return SQL`
    SELECT
      utility
    FROM
      `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.item
    LEFT JOIN marketplace.mv_builder_server_items_utility ON item.id = mv_builder_server_items_utility.item_id
    WHERE item.collection_id = ${contractAddress} AND blockchain_id = ${itemId}
  `
    )
}

export function getItemByItemIdQuery(contractAddress: string, itemId: string) {
  return getItemsQuery({ contractAddresses: [contractAddress], itemId })
}
