import SQL, { SQLStatement } from 'sql-template-strings'
import { EmotePlayMode, GenderFilterOption, ItemFilters, ListingStatus, TradeAssetType, TradeType, WearableGender } from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getDBNetworks } from '../../utils'
import { getTradesCTE } from '../catalog/queries'
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

function getItemsLimitAndOffsetStatement(filters: ItemFilters) {
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

// TODO: Add sort by logic
function getItemsWhereStatement(filters: ItemQueryFilters): SQLStatement {
  if (!filters) {
    return SQL``
  }

  const FILTER_BY_CATEGORY = filters.category ? SQL` LOWER(item.item_type) = ANY (${getItemTypesFromNFTCategory(filters.category)}) ` : null
  const creators = filters.creator && (Array.isArray(filters.creator) ? filters.creator : [filters.creator])
  const FILTER_BY_CREATOR =
    creators && creators.length ? SQL` LOWER(item.creator) = ANY(${creators.map(creator => creator.toLowerCase())}) ` : null
  const FITLER_BY_RARITY = filters.rarities && filters.rarities.length ? SQL` item.rarity = ANY (${filters.rarities}) ` : null
  const FILTER_BY_SOLD_OUT = filters.isSoldOut ? SQL` item.available = 0 ` : null
  const FILTER_BY_IS_ON_SALE = filters.isOnSale
    ? SQL` (((unified_trades.id IS NOT NULL AND item.search_is_marketplace_v3_minter = true) OR item.search_is_store_minter = true) AND item.available > 0) `
    : null
  const FILTER_BY_TEXT = filters.search ? SQL` item.search_text % ${filters.search} ` : null
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
  const FILTER_BY_HAS_SOUND = filters.emoteHasSound ? SQL` emote.has_sound = true ` : null
  const FILTER_BY_HAS_GEOMETRY = filters.emoteHasGeometry ? SQL` emote.has_geometry = true ` : null
  // For now, let's filter if the outcome type is not null
  const FILTER_BY_OUTCOME_TYPE = filters.emoteOutcomeType ? SQL` emote.outcome_type IS NOT NULL ` : null
  const FILTER_BY_URNS = filters.urns && filters.urns.length ? SQL` item.urn = ANY (${filters.urns}) ` : null
  // Social emotes (those with an outcome type) are included by default; excluded only when includeSocialEmotes=false.
  // Note: passing emoteOutcomeType together with includeSocialEmotes=false is contradictory and returns no emotes.
  const EXCLUDE_SOCIAL_EMOTES = filters.includeSocialEmotes === false ? SQL` emote.outcome_type IS NULL ` : null
  return getWhereStatementFromFilters([
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
    FILTER_BY_HAS_SOUND,
    FILTER_BY_HAS_GEOMETRY,
    FILTER_BY_OUTCOME_TYPE,
    FILTER_BY_URNS,
    EXCLUDE_SOCIAL_EMOTES
  ])
}

export function getItemsQuery(filters: ItemQueryFilters = {}) {
  return getTradesCTE({
    category: filters.category,
    first: filters.first,
    skip: filters.skip
  }).append(
    SQL`
    SELECT
      COUNT(*) OVER() as count,
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
      unified_trades.assets -> 'received' ->> 'amount' as trade_price
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
                        ` LEFT JOIN unified_trades ON sent_item_id = item.blockchain_id::text AND sent_contract_address = item.collection_id AND type = '${TradeType.PUBLIC_ITEM_ORDER}' AND status = '${ListingStatus.OPEN}' `
                      )
                      .append(getItemsWhereStatement(filters))
                      .append(getItemsLimitAndOffsetStatement(filters))
                  )
              )
          )
      )
  )
}

// 1 credit = $0.10; $1 = 1e18 USD wei = 10 credits, so 1 credit = 1e17 USD wei. Kept as a literal
// string so the SQL numeric math stays exact (no float precision loss).
const USD_WEI_PER_CREDIT = '100000000000000000'

// The asset-type-aware `price_credits` column for the catalog-items feed. Unlike the mixed-unit
// `/v1/items` `price`, this normalizes every item to whole credits, CEIL-consistent with the native
// Shop path ("Model B"):
//   - a v3 trade priced in USD-pegged MANA (asset_type = USD_PEGGED_MANA) is already USD wei -> no rate;
//   - a v3 trade priced in classic MANA/ERC20, or a classic store-minter `item.price` (MANA wei), is
//     multiplied by the MANA/USD rate to reach USD wei;
//   - anything not currently for sale (available = 0, no open minter) -> 0.
// The trade branch mirrors fromDBItemToItem's precedence (open v3 trade wins over the store minter).
function getPriceCreditsSelect(rateNumericString: string): SQLStatement {
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
      END::bigint AS price_credits`
}

// The credit-aware catalog-items feed backing GET /v3/catalog/items. Same data source and full-catalog
// semantics as getItemsQuery (ALL items incl. not-on-sale, keyed by item, filterable by creator/contract
// address/category/rarity/search) but with a server-computed, asset-type-aware `price_credits` per item.
// Mirrors getItemsQuery's SELECT/joins so the row maps through fromDBItemToItem unchanged, plus the one
// extra column. `rateNumericString` is the MANA/USD rate as a fixed-precision numeric literal.
export function getCatalogItemsQuery(filters: ItemQueryFilters = {}, rateNumericString = '0') {
  return getTradesCTE({
    category: filters.category,
    first: filters.first,
    skip: filters.skip
  })
    .append(
      SQL`
    SELECT
      COUNT(*) OVER() as count,
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
                          ` LEFT JOIN unified_trades ON sent_item_id = item.blockchain_id::text AND sent_contract_address = item.collection_id AND type = '${TradeType.PUBLIC_ITEM_ORDER}' AND status = '${ListingStatus.OPEN}' `
                        )
                        .append(getItemsWhereStatement(filters))
                        .append(getItemsLimitAndOffsetStatement(filters))
                    )
                )
            )
        )
    )
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
