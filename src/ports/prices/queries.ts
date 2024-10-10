import SQL, { SQLStatement } from 'sql-template-strings'
import { EmotePlayMode, GenderFilterOption, Rarity, WearableGender } from '@dcl/schemas'
import { getDBNetworks } from '../../utils'
import { ItemType } from '../items'
import { getWhereStatementFromFilters } from '../utils'
import { PriceFilters } from './types'

function getEmotePlayModeWhereStatement(emotePlayMode: EmotePlayMode | EmotePlayMode[] | undefined): SQLStatement | null {
  if (!emotePlayMode || (Array.isArray(emotePlayMode) && (emotePlayMode.length === 2 || emotePlayMode.length === 0))) {
    return null
  }

  if (emotePlayMode === EmotePlayMode.LOOP || (Array.isArray(emotePlayMode) && emotePlayMode.includes(EmotePlayMode.LOOP))) {
    return SQL` nft.search_emote_loop = true `
  }

  return SQL` nft.search_emote_loop = false `
}

function getGenderWhereStatement(isEmote: boolean, genders?: (WearableGender | GenderFilterOption)[]): SQLStatement | null {
  if (!genders || !genders.length) {
    return null
  }

  const hasUnisex = genders.includes(GenderFilterOption.UNISEX)
  const hasMale = hasUnisex || genders.includes(GenderFilterOption.MALE)
  const hasFemale = hasUnisex || genders.includes(GenderFilterOption.FEMALE)
  const searchProperty = isEmote ? 'search_emote_body_shapes' : 'search_wearable_body_shapes'
  const bodyShapesArray = []

  if (hasMale) {
    bodyShapesArray.push('BaseMale')
  }

  if (hasFemale) {
    bodyShapesArray.push('BaseFemale')
  }

  return bodyShapesArray.length ? SQL` ${searchProperty} @> ${bodyShapesArray} ` : null
}

function getRarityWhereStatement(rarities?: Rarity[]): SQLStatement | null {
  if (!rarities || !rarities.length) {
    return null
  }

  return SQL` (nft.search_wearable_rarity = ANY (${rarities}) OR nft.search_emote_rarity = ANY (${rarities})) `
}

function getPricesWhereStatement(filters: PriceFilters): SQLStatement {
  if (!filters) {
    return SQL``
  }

  const FILTER_BY_NETWORK = filters.network ? SQL` nft.network = ANY (${getDBNetworks(filters.network)}) ` : null
  const FILTER_BY_HAS_SOUND = filters.emoteHasSound ? SQL` emote.has_sound = true ` : null
  const FILTER_BY_HAS_GEOMETRY = filters.emoteHasGeometry ? SQL` emote.has_geometry = true ` : null
  const FILTER_MIN_ESTATE_SIZE = filters.minEstateSize
    ? SQL` estate.size >= ${filters.minEstateSize} `
    : SQL` (estate.size IS NULL OR estate.size > 0) `
  const FILTER_MAX_ESTATE_SIZE = filters.maxEstateSize ? SQL` estate.size <= ${filters.maxEstateSize} ` : null
  const FILTER_BY_WEARABLE_CATEGORY = filters.wearableCategory ? SQL` wearable.category = ${filters.wearableCategory} ` : null
  const FILTER_BY_EMOTE_CATEGORY = filters.emoteCategory ? SQL` emote.category = ${filters.emoteCategory} ` : null
  const FILTER_BY_WEARABLE_HEAD = filters.isWearableHead ? SQL` nft.search_is_wearable_head = true ` : null
  const FILTER_BY_WEARABLE_ACCESSORY = filters.isWearableAccessory ? SQL` nft.search_is_wearable_accessory = true ` : null
  const FILTER_BY_WEARABLE_SMART = filters.isWearableSmart ? SQL` nft.item_type = ${ItemType.SMART_WEARABLE_V1} ` : null
  const FILTER_BY_CONTRACT_ADDRESS =
    filters.contractAddresses && filters.contractAddresses.length ? SQL` nft.contract_address = ANY (${filters.contractAddresses}) ` : null

  const FILTER_BY_ADJACENT_TO_ROAD = filters.adjacentToRoad ? SQL` nft.search_adjacent_to_road = true ` : null
  const FILTER_BY_EMOTE_PLAY_MODE = getEmotePlayModeWhereStatement(filters.emotePlayMode)
  const FILTER_BY_EMOTE_GENDERS = getGenderWhereStatement(true, filters.emoteGenders)
  const FILTER_BY_WEARABLE_GENDER = getGenderWhereStatement(false, filters.wearableGenders)
  const FITLER_BY_RARITY = getRarityWhereStatement(filters.itemRarities)

  return getWhereStatementFromFilters([
    FILTER_BY_NETWORK,
    FILTER_BY_HAS_SOUND,
    FILTER_BY_HAS_GEOMETRY,
    FILTER_MIN_ESTATE_SIZE,
    FILTER_MAX_ESTATE_SIZE,
    FILTER_BY_EMOTE_CATEGORY,
    FILTER_BY_WEARABLE_CATEGORY,
    FILTER_BY_WEARABLE_HEAD,
    FILTER_BY_WEARABLE_ACCESSORY,
    FILTER_BY_WEARABLE_SMART,
    FILTER_BY_CONTRACT_ADDRESS,
    FILTER_BY_ADJACENT_TO_ROAD,
    FILTER_BY_EMOTE_PLAY_MODE,
    FILTER_BY_EMOTE_GENDERS,
    FILTER_BY_WEARABLE_GENDER,
    FITLER_BY_RARITY
  ])
}

function getLegacySalesQuery(): string {
  return `
  `
}

function getTradeSalesQuery(): string {
  return `


  `
}

export function getPricesQuery(filters: PriceFilters) {
  const LEGACY_SALES = ` (${getLegacySalesQuery()}) as legacy_sales `
  const TRADE_SALES = ` (${getTradeSalesQuery()}) as trade_sales `

  return SQL`SELECT *, COUNT(*) OVER() as count`
    .append(SQL` FROM `)
    .append(LEGACY_SALES)
    .append(SQL` NATURAL FULL OUTER JOIN `)
    .append(TRADE_SALES)
    .append(getPricesWhereStatement(filters))
}
