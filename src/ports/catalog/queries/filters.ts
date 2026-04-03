import SQL from 'sql-template-strings'
import { CatalogFilters, EmoteCategory, EmotePlayMode, GenderFilterOption, NFTCategory, Network, WearableCategory } from '@dcl/schemas'
import { FragmentItemType } from '../utils'

export const WEARABLE_ITEM_TYPES = [FragmentItemType.WEARABLE_V1, FragmentItemType.WEARABLE_V2, FragmentItemType.SMART_WEARABLE_V1]

export const getCategoryWhere = (filters: CatalogFilters) => {
  const { category, isWearableSmart } = filters
  return category === NFTCategory.WEARABLE
    ? isWearableSmart
      ? SQL`items.item_type = '`.append(FragmentItemType.SMART_WEARABLE_V1).append(SQL`'`)
      : SQL`items.item_type IN `.append(
          SQL`
            (`
            .append(WEARABLE_ITEM_TYPES.map(itemType => `'${itemType}'`).join(', '))
            .append(SQL`)`)
        )
    : category === NFTCategory.EMOTE
    ? SQL`items.item_type = '`.append(FragmentItemType.EMOTE_V1).append(SQL`'`)
    : undefined
}

export const getWearableCategoryWhere = (filters: CatalogFilters) => {
  return WearableCategory.validate(filters.wearableCategory)
    ? SQL`metadata_wearable.category = '`.append(filters.wearableCategory).append(SQL`'`)
    : undefined
}

export const getEmoteCategoryWhere = (filters: CatalogFilters) => {
  return EmoteCategory.validate(filters.emoteCategory)
    ? SQL`metadata_emote.category = '`.append(filters.emoteCategory).append(SQL`'`)
    : undefined
}

export const getEmotePlayModeWhere = (filters: CatalogFilters) => {
  return Array.isArray(filters.emotePlayMode)
    ? filters.emotePlayMode.length === 1
      ? SQL`metadata_emote.loop = ${filters.emotePlayMode[0] === EmotePlayMode.LOOP}`
      : undefined
    : SQL`metadata_emote.loop = ${filters.emotePlayMode === EmotePlayMode.LOOP}`
}

export const getSearchWhere = (filters: CatalogFilters) => {
  return SQL`lower(word::text) % lower(${filters.search})`
}

export const getIsSoldOutWhere = () => {
  return SQL`items.available = 0`
}

export const getIsOnSale = (filters: CatalogFilters) => {
  return filters.isOnSale
    ? SQL`((search_is_store_minter = true AND available > 0) OR listings_count IS NOT NULL)`
    : SQL`((search_is_store_minter = false OR available = 0) AND listings_count IS NULL)`
}

export const getIsOnSaleWithTrades = (filters: CatalogFilters) => {
  if (filters.onlyMinting && filters.isOnSale) {
    return SQL`((search_is_store_minter = true OR (search_is_marketplace_v3_minter = true AND offchain_orders.count IS NOT NULL)) AND available > 0)`
  }
  return filters.isOnSale
    ? SQL`(((search_is_store_minter = true OR (search_is_marketplace_v3_minter = true AND offchain_orders.count IS NOT NULL)) AND available > 0) OR (nfts_with_orders.orders_listings_count IS NOT NULL OR offchain_orders.nfts_listings_count IS NOT NULL))`
    : SQL`(((search_is_store_minter = false AND search_is_marketplace_v3_minter = false) OR available = 0) OR (search_is_marketplace_v3_minter = true AND (nfts_with_orders.orders_listings_count IS NULL AND offchain_orders.count IS NULL)))`
}

export const getIsWearableHeadAccessoryWhere = () => {
  return SQL`items.search_is_wearable_head = true`
}

export const getWearableAccessoryWhere = () => {
  return SQL`items.search_is_wearable_accessory = true`
}

export const getWearableGenderWhere = (filters: CatalogFilters) => {
  const { wearableGenders: genders } = filters
  const parsedGenders = []
  if (genders?.includes(GenderFilterOption.FEMALE)) {
    parsedGenders.push('BaseFemale')
  }
  if (genders?.includes(GenderFilterOption.MALE)) {
    parsedGenders.push('BaseMale')
  }
  return parsedGenders.length ? SQL`items.search_wearable_body_shapes @> (${parsedGenders})` : undefined
}

export const getCreatorWhere = (filters: CatalogFilters) => {
  return Array.isArray(filters.creator) ? SQL`items.creator = ANY(${filters.creator})` : SQL`items.creator = ${filters.creator}`
}

export const getRaritiesWhere = (filters: CatalogFilters) => {
  return SQL`items.rarity = ANY(${filters.rarities})`
}

export const getOrderRangePriceWhere = (filters: CatalogFilters) => {
  if (filters.minPrice && !filters.maxPrice) {
    return SQL`AND orders.price >= ${filters.minPrice}`
  } else if (!filters.minPrice && filters.maxPrice) {
    return SQL`AND orders.price <= ${filters.maxPrice}`
  } else if (filters.minPrice && filters.maxPrice) {
    return SQL`AND orders.price >= ${filters.minPrice} AND orders.price <= ${filters.maxPrice}`
  }
  return SQL``
}

export const getMinPriceWhere = (filters: CatalogFilters, isV2 = false) => {
  if (filters.onlyMinting) {
    return SQL`(price >= ${filters.minPrice} AND price IS DISTINCT FROM ${MAX_NUMERIC_NUMBER})`
  } else if (filters.onlyListing) {
    return SQL`min_price >= ${filters.minPrice}`
  }
  const base = SQL`(min_price >= ${filters.minPrice} OR (price >= ${filters.minPrice} AND available > 0 AND (search_is_store_minter = true OR search_is_marketplace_v3_minter = true))`
  if (isV2) {
    base.append(SQL` OR offchain_orders.min_order_amount_received >= ${filters.minPrice}`)
  }
  base.append(SQL`)`)
  return base
}

export const getMaxPriceWhere = (filters: CatalogFilters, isV2 = false) => {
  if (filters.onlyMinting) {
    return SQL`price <= ${filters.maxPrice}`
  } else if (filters.onlyListing) {
    return SQL`max_price <= ${filters.maxPrice}`
  }
  const base = SQL`(max_price <= ${filters.maxPrice} OR (price <= ${filters.maxPrice} AND available > 0 AND (search_is_store_minter = true OR search_is_marketplace_v3_minter = true))`
  if (isV2) {
    base.append(SQL` OR offchain_orders.max_order_amount_received <= ${filters.maxPrice}`)
  }
  base.append(SQL`)`)
  return base
}

export const getContractAddressWhere = (filters: CatalogFilters) => {
  return SQL`items.collection_id = ANY(${filters.contractAddresses})`
}

export const getOnlyListingsWhere = () => {
  return SQL`(items.search_is_store_minter = false OR (items.search_is_store_minter = true AND available = 0)) AND listings_count > 0`
}

export const getOnlyListingsWhereWithTrades = () => {
  return SQL`((items.search_is_store_minter = false AND items.search_is_marketplace_v3_minter = false) OR (items.search_is_store_minter = true AND available = 0) OR (items.search_is_marketplace_v3_minter = true AND COALESCE(offchain_orders.items_listings_count, 0) = 0)) AND (COALESCE(nfts_with_orders.orders_listings_count, 0) + COALESCE(offchain_orders.nfts_listings_count, 0)) > 0`
}

export const getOnlyMintingWhere = () => {
  return SQL`items.search_is_store_minter = true AND available > 0`
}

export const getOnlyMintingWhereWithTrades = () => {
  return SQL`(((items.search_is_store_minter = true OR (items.search_is_marketplace_v3_minter = true AND offchain_orders.count IS NOT NULL))) AND available > 0)`
}

export const getIdsWhere = (filters: CatalogFilters) => {
  return SQL`items.id = ANY(${filters.ids})`
}

export const getHasSoundWhere = () => {
  return SQL`items.search_emote_has_sound = true`
}

export const getHasGeometryWhere = () => {
  return SQL`items.search_emote_has_geometry = true`
}

// For now, let's filter if the outcome type is not null
export const getHasOutcomeTypeWhere = (_filters: CatalogFilters) => {
  return SQL`items.search_emote_outcome_type IS NOT NULL`
}

export const getUrnsWhere = (filters: CatalogFilters) => {
  return SQL`items.urn = ANY(${filters.urns})`
}

export const getNetworkWhere = (filters: CatalogFilters) => {
  return SQL`items.network = ${filters.network === Network.MATIC ? 'POLYGON' : filters.network}`
}

/** Helper to build WHERE clause with item-level filters only (no joins needed) */
export const getItemLevelFiltersWhere = (filters: CatalogFilters) => {
  const conditions = [
    filters.category ? getCategoryWhere(filters) : undefined,
    filters.rarities?.length ? getRaritiesWhere(filters) : undefined,
    filters.creator?.length ? getCreatorWhere(filters) : undefined,
    filters.isSoldOut ? getIsSoldOutWhere() : undefined,
    filters.isWearableHead ? getIsWearableHeadAccessoryWhere() : undefined,
    filters.isWearableAccessory ? getWearableAccessoryWhere() : undefined,
    filters.wearableCategory ? getWearableCategoryWhere(filters) : undefined,
    filters.wearableGenders?.length ? getWearableGenderWhere(filters) : undefined,
    filters.emoteCategory ? getEmoteCategoryWhere(filters) : undefined,
    filters.emotePlayMode?.length ? getEmotePlayModeWhere(filters) : undefined,
    filters.contractAddresses?.length ? getContractAddressWhere(filters) : undefined,
    filters.ids?.length ? getIdsWhere(filters) : undefined,
    filters.emoteHasSound ? getHasSoundWhere() : undefined,
    filters.emoteHasGeometry ? getHasGeometryWhere() : undefined,
    filters.emoteOutcomeType ? getHasOutcomeTypeWhere(filters) : undefined,
    filters.urns?.length ? getUrnsWhere(filters) : undefined,
    filters.network ? getNetworkWhere(filters) : undefined
  ].filter(Boolean)

  const whereClause = SQL`WHERE items.search_is_collection_approved = true`
  if (conditions.length > 0) {
    whereClause.append(SQL` AND `)
    conditions.forEach((condition, index) => {
      if (condition) {
        whereClause.append(condition)
        if (conditions[index + 1]) {
          whereClause.append(SQL` AND `)
        }
      }
    })
  }

  return whereClause
}

export const getCollectionsQueryWhere = (filters: CatalogFilters, isV2 = false) => {
  const conditions = [
    filters.category ? getCategoryWhere(filters) : undefined,
    filters.rarities?.length ? getRaritiesWhere(filters) : undefined,
    filters.creator?.length ? getCreatorWhere(filters) : undefined,
    filters.isSoldOut ? getIsSoldOutWhere() : undefined,
    filters.isOnSale !== undefined ? (isV2 ? getIsOnSaleWithTrades(filters) : getIsOnSale(filters)) : undefined,
    filters.isWearableHead ? getIsWearableHeadAccessoryWhere() : undefined,
    filters.isWearableAccessory ? getWearableAccessoryWhere() : undefined,
    filters.wearableCategory ? getWearableCategoryWhere(filters) : undefined,
    filters.wearableGenders?.length ? getWearableGenderWhere(filters) : undefined,
    filters.emoteCategory ? getEmoteCategoryWhere(filters) : undefined,
    filters.emotePlayMode?.length ? getEmotePlayModeWhere(filters) : undefined,
    filters.contractAddresses?.length ? getContractAddressWhere(filters) : undefined,
    filters.minPrice ? getMinPriceWhere(filters, isV2) : undefined,
    filters.maxPrice ? getMaxPriceWhere(filters, isV2) : undefined,
    filters.onlyListing ? (isV2 ? getOnlyListingsWhereWithTrades() : getOnlyListingsWhere()) : undefined,
    filters.onlyMinting ? (isV2 ? getOnlyMintingWhereWithTrades() : getOnlyMintingWhere()) : undefined,
    filters.ids?.length ? getIdsWhere(filters) : undefined,
    filters.emoteHasSound ? getHasSoundWhere() : undefined,
    filters.emoteHasGeometry ? getHasGeometryWhere() : undefined,
    filters.emoteOutcomeType ? getHasOutcomeTypeWhere(filters) : undefined,
    filters.urns?.length ? getUrnsWhere(filters) : undefined,
    filters.network ? getNetworkWhere(filters) : undefined
  ].filter(Boolean)

  const result = SQL`WHERE items.search_is_collection_approved = true `
  if (!conditions.length) {
    return result
  } else {
    result.append(SQL` AND `)
  }
  conditions.forEach((condition, index) => {
    if (condition) {
      result.append(condition)
      if (conditions[index + 1]) {
        result.append(SQL` AND `)
      }
    }
  })

  return result.append(' ')
}

// Used by getMinPriceWhere — keep private constant here
const MAX_NUMERIC_NUMBER = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
