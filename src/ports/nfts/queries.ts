import SQL, { SQLStatement } from 'sql-template-strings'
import {
  EmotePlayMode,
  GenderFilterOption,
  ListingStatus,
  Network,
  NFTCategory,
  NFTSortBy,
  Rarity,
  TradeType,
  WearableGender
} from '@dcl/schemas'
import { getDBNetworks } from '../../utils'
import { ItemType } from '../items'
import { getTradesForTypeQuery } from '../trades/queries'
import { getWhereStatementFromFilters } from '../utils'
import { GetNFTsFilters } from './types'

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

function getNFTWhereStatement(nftFilters: GetNFTsFilters): SQLStatement {
  if (!nftFilters) {
    return SQL``
  }

  const FILTER_BY_CATEGORY = nftFilters.category ? SQL` LOWER(nft.category) = LOWER(${nftFilters.category}) ` : null
  const FILTER_BY_OWNER = nftFilters.owner ? SQL` LOWER(account.address) = LOWER(${nftFilters.owner}) ` : null
  const FILTER_BY_TOKEN_ID = nftFilters.tokenId ? SQL` nft.token_id = ${nftFilters.tokenId} ` : null
  const FILTER_BY_ITEM_ID = nftFilters.itemId ? SQL` LOWER(nft.item_id) = LOWER(${nftFilters.itemId}) ` : null
  const FILTER_BY_NETWORK = nftFilters.network ? SQL` nft.network = ANY (${getDBNetworks(nftFilters.network)}) ` : null
  const FILTER_BY_HAS_SOUND = nftFilters.emoteHasSound ? SQL` emote.has_sound = true ` : null
  const FILTER_BY_HAS_GEOMETRY = nftFilters.emoteHasGeometry ? SQL` emote.has_geometry = true ` : null
  const FILTER_MIN_ESTATE_SIZE = nftFilters.minEstateSize
    ? SQL` estate.size >= ${nftFilters.minEstateSize} `
    : SQL` (estate.size IS NULL OR estate.size > 0) `
  const FILTER_MAX_ESTATE_SIZE = nftFilters.maxEstateSize ? SQL` estate.size <= ${nftFilters.maxEstateSize} ` : null
  const FILTER_BY_WEARABLE_CATEGORY = nftFilters.wearableCategory ? SQL` wearable.category = ${nftFilters.wearableCategory} ` : null
  const FILTER_BY_EMOTE_CATEGORY = nftFilters.emoteCategory ? SQL` emote.category = ${nftFilters.emoteCategory} ` : null
  const FILTER_BY_WEARABLE_HEAD = nftFilters.isWearableHead ? SQL` nft.search_is_wearable_head = true ` : null
  const FILTER_BY_LAND = nftFilters.isLand ? SQL` nft.search_is_land = true ` : null
  const FILTER_BY_WEARABLE_ACCESSORY = nftFilters.isWearableAccessory ? SQL` nft.search_is_wearable_accessory = true ` : null
  const FILTER_BY_WEARABLE_SMART = nftFilters.isWearableSmart ? SQL` nft.item_type = ${ItemType.SMART_WEARABLE_V1} ` : null
  const FILTER_BY_CONTRACT_ADDRESS =
    nftFilters.contractAddresses && nftFilters.contractAddresses.length
      ? SQL` nft.contract_address = ANY (${nftFilters.contractAddresses}) `
      : null
  const FILTER_BY_TEXT = nftFilters.search ? SQL` nft.search_text % ${nftFilters.search} ` : null
  const FILTER_BY_MIN_DISTANCE_TO_PLAZA = nftFilters.minDistanceToPlaza
    ? SQL` nft.search_distance_to_plaza >= ${nftFilters.minDistanceToPlaza} `
    : null
  const FILTER_BY_MAX_DISTANCE_TO_PLAZA = nftFilters.maxDistanceToPlaza
    ? SQL` nft.search_distance_to_plaza <= ${nftFilters.maxDistanceToPlaza} `
    : null
  const FILTER_BY_ADJACENT_TO_ROAD = nftFilters.adjacentToRoad ? SQL` nft.search_adjacent_to_road = true ` : null
  const FILTER_BY_EMOTE_PLAY_MODE = getEmotePlayModeWhereStatement(nftFilters.emotePlayMode)
  const FILTER_BY_EMOTE_GENDERS = getGenderWhereStatement(true, nftFilters.emoteGenders)
  const FILTER_BY_WEARABLE_GENDER = getGenderWhereStatement(false, nftFilters.wearableGenders)
  const creators = nftFilters.creator && (Array.isArray(nftFilters.creator) ? nftFilters.creator : [nftFilters.creator])
  const FILTER_BY_CREATOR =
    creators && creators.length ? SQL` LOWER(item.creator) = ANY(${creators.map(creator => creator.toLowerCase())}) ` : null
  const FILTER_BY_ID = nftFilters.ids && nftFilters.ids.length ? SQL` nft.id = ANY (${nftFilters.ids}) ` : null
  const FITLER_BY_RARITY = getRarityWhereStatement(nftFilters.itemRarities)
  const FILTER_BY_MIN_PRICE = nftFilters.minPrice
    ? SQL` (nft.search_order_price >= ${nftFilters.minPrice} OR (trades.assets -> 'received' ->> 'amount')::numeric(78) >= ${nftFilters.minPrice})`
    : null
  const FILTER_BY_MAX_PRICE = nftFilters.maxPrice
    ? SQL` (nft.search_order_price <= ${nftFilters.maxPrice} OR (trades.assets -> 'received' ->> 'amount')::numeric(78) <= ${nftFilters.maxPrice})`
    : null
  const FILTER_BY_ON_SALE = nftFilters.isOnSale ? SQL` (trades.id IS NOT NULL OR nft.search_order_status = ${ListingStatus.OPEN}) ` : null
  const FITLER_BANNED_NAMES =
    nftFilters.bannedNames && nftFilters.bannedNames.length
      ? SQL` (nft.category != ${NFTCategory.ENS} OR nft.name <> ALL (${nftFilters.bannedNames})) `
      : null

  return getWhereStatementFromFilters([
    FILTER_BY_CATEGORY,
    FILTER_BY_OWNER,
    FILTER_BY_TOKEN_ID,
    FILTER_BY_ITEM_ID,
    FILTER_BY_NETWORK,
    FILTER_BY_HAS_SOUND,
    FILTER_BY_HAS_GEOMETRY,
    FILTER_MIN_ESTATE_SIZE,
    FILTER_MAX_ESTATE_SIZE,
    FILTER_BY_EMOTE_CATEGORY,
    FILTER_BY_WEARABLE_CATEGORY,
    FILTER_BY_WEARABLE_HEAD,
    FILTER_BY_LAND,
    FILTER_BY_WEARABLE_ACCESSORY,
    FILTER_BY_WEARABLE_SMART,
    FILTER_BY_CONTRACT_ADDRESS,
    FILTER_BY_TEXT,
    FILTER_BY_MIN_DISTANCE_TO_PLAZA,
    FILTER_BY_MAX_DISTANCE_TO_PLAZA,
    FILTER_BY_ADJACENT_TO_ROAD,
    FILTER_BY_EMOTE_PLAY_MODE,
    FILTER_BY_EMOTE_GENDERS,
    FILTER_BY_WEARABLE_GENDER,
    FILTER_BY_CREATOR,
    FILTER_BY_ID,
    FITLER_BY_RARITY,
    FILTER_BY_MIN_PRICE,
    FILTER_BY_MAX_PRICE,
    FILTER_BY_ON_SALE,
    FITLER_BANNED_NAMES
  ])
}

function getNFTLimitAndOffsetStatement(nftFilters?: GetNFTsFilters) {
  const limit = nftFilters?.first ? nftFilters.first : 100
  const offset = nftFilters?.skip ? nftFilters.skip : 0

  return SQL` LIMIT ${limit} OFFSET ${offset} `
}

export function getNFTsSortByStatement(sortBy?: NFTSortBy) {
  switch (sortBy) {
    case NFTSortBy.NAME:
      return SQL` ORDER BY name ASC `
    case NFTSortBy.NEWEST:
      return SQL` ORDER BY created_at DESC `
    case NFTSortBy.RECENTLY_LISTED:
      return SQL` ORDER BY order_created_at DESC `
    case NFTSortBy.RECENTLY_SOLD:
      return SQL` ORDER BY sold_at DESC `
    default:
      return SQL` ORDER BY created_at DESC `
  }
}
/**
 * Returns a query to fetch NFTs
 * @param nftFilters Filters to apply to the query
 * @param uncapped If true, the query will not limit the number of results
 * @returns The query to fetch NFTs
 */
export function getNFTsQuery(nftFilters: GetNFTsFilters = {}, uncapped = false): SQLStatement {
  return SQL`
    SELECT
      COUNT(*) OVER() as count,
      nft.id,
      nft.contract_address,
      nft.token_id,
      nft.network,
      nft.created_at,
      nft.token_uri as url,
      nft.updated_at,
      nft.sold_at,
      nft.urn,
      COALESCE(nft.search_order_price, (trades.assets -> 'received' ->> 'amount')::numeric(78)) as price,
      account.address as owner,
      nft.image,
      nft.issued_id,
      item.blockchain_id as item_id,
      nft.category,
      coalesce (wearable.rarity, emote.rarity) as rarity,
      coalesce (wearable.name, emote.name, land_data."name", ens.subdomain) as name,
      parcel.x,
      parcel.y,
      ens.subdomain,
      wearable.body_shapes,
      wearable.category as wearable_category,
      emote.category as emote_category,
      nft.item_type,
      emote.loop,
      emote.has_sound,
      emote.has_geometry,
      estate.estate_parcels,
      estate.size as size,
      parcel.parcel_estate_token_id,
      parcel.parcel_estate_name,
      parcel.estate_id as parcel_estate_id,
      coalesce (wearable.description, emote.description, land_data.description) as description,
      coalesce (to_timestamp(nft.search_order_created_at), trades.created_at) as order_created_at,
      trades.assets
    FROM
      squid_marketplace.nft nft
    LEFT JOIN squid_marketplace.metadata metadata on
      nft.metadata_id = metadata.id
    LEFT JOIN squid_marketplace.wearable wearable on
      metadata.wearable_id = wearable.id
    LEFT JOIN squid_marketplace.emote emote on
      metadata.emote_id = emote.id
    LEFT JOIN (
      SELECT par.*, par_est.token_id as parcel_estate_token_id, est_data.name as parcel_estate_name
      FROM squid_marketplace.parcel par
      LEFT JOIN squid_marketplace.estate par_est ON par.estate_id = par_est.id
      LEFT JOIN squid_marketplace.data est_data on par_est.data_id = est_data.id
    ) as parcel on nft.id = parcel.id
    LEFT JOIN (
      SELECT est.id, est.token_id, est.size, est.data_id, array_agg(json_build_object('x', est_parcel.x, 'y', est_parcel.y)) as estate_parcels
      FROM squid_marketplace.estate est
      LEFT JOIN squid_marketplace.parcel est_parcel ON est.id = est_parcel.estate_id
      GROUP BY est.id, est.token_id, est.size, est.data_id
    ) as estate on nft.id = estate.id
    LEFT JOIN squid_marketplace.data land_data on (estate.data_id  = land_data.id or parcel.id = land_data.id)
    LEFT JOIN squid_marketplace.ens ens on ens.id = nft.ens_id 
    LEFT JOIN squid_marketplace.account account on nft.owner_id = account.id
    LEFT JOIN squid_marketplace.item item on item.id = nft.item_id
  `
    .append(
      ` LEFT JOIN (${getTradesForTypeQuery(
        TradeType.PUBLIC_NFT_ORDER
      )}) as trades ON trades.assets -> 'sent' ->> 'token_id' = nft.token_id::text AND trades.assets -> 'sent' ->> 'contract_address' = nft.contract_address AND trades.status = '${
        ListingStatus.OPEN
      }' AND trades.signer = account.address`
    )
    .append(getNFTWhereStatement(nftFilters))
    .append(getNFTsSortByStatement(nftFilters.sortBy))
    .append(uncapped ? SQL`` : getNFTLimitAndOffsetStatement(nftFilters))
}

export function getNftByTokenIdQuery(contractAddress: string, tokenId: string, network: Network) {
  return getNFTsQuery({ tokenId, network, contractAddresses: [contractAddress] })
}
