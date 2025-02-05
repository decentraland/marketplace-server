import SQL, { SQLStatement } from 'sql-template-strings'
import { EmotePlayMode, GenderFilterOption, ListingStatus, Network, NFTCategory, NFTSortBy, Rarity, WearableGender } from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getDBNetworks } from '../../utils'
import { getTradesCTE, MAX_ORDER_TIMESTAMP } from '../catalog/queries'
import { ItemType } from '../items'
import { getWhereStatementFromFilters } from '../utils'
import { getENSs } from './ensQueries'
import { getAllLANDsQuery, getLandsOnSaleQuery } from './landQueries'
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

function getFilteredNFTCTE(nftFilters: GetNFTsFilters, uncapped = false): SQLStatement {
  const ownerEthereumAddress = nftFilters.owner ? `${nftFilters.owner.toLocaleLowerCase()}-ETHEREUM` : null
  const ownerPolygonAddress = nftFilters.owner ? `${nftFilters.owner.toLocaleLowerCase()}-POLYGON` : null
  const FILTER_BY_OWNER = nftFilters.owner ? SQL` owner_id = ${ownerEthereumAddress} OR owner_id = ${ownerPolygonAddress} ` : null
  const FILTER_BY_CATEGORY = nftFilters.category ? SQL` category = ${nftFilters.category.toLocaleLowerCase()} ` : null
  const FILTER_BY_TOKEN_ID = nftFilters.tokenId ? SQL` token_id = ${nftFilters.tokenId} ` : null
  const FILTER_BY_ITEM_ID = nftFilters.itemId ? SQL` LOWER(item_id) = LOWER(${nftFilters.itemId}) ` : null
  const FILTER_BY_NETWORK = nftFilters.network ? SQL` network = ANY (${getDBNetworks(nftFilters.network)}) ` : null
  const FILTER_BY_WEARABLE_HEAD = nftFilters.isWearableHead ? SQL` search_is_wearable_head = true ` : null
  const FILTER_BY_LAND = nftFilters.isLand ? SQL` search_is_land = true ` : null
  const FILTER_BY_WEARABLE_ACCESSORY = nftFilters.isWearableAccessory ? SQL` search_is_wearable_accessory = true ` : null
  const FILTER_BY_SMART_WEARABLE = nftFilters.isWearableSmart ? SQL` item_type = ${ItemType.SMART_WEARABLE_V1} ` : null
  const FILTER_BY_CONTRACT_ADDRESSES = nftFilters.contractAddresses?.length
    ? SQL` contract_address = ANY (${nftFilters.contractAddresses}) `
    : null

  const FILTER_BY_SEARCH = nftFilters.search ? SQL` search_text % ${nftFilters.search} ` : null
  const FILTER_BY_MIN_PLAZA_DISTANCE = nftFilters.minDistanceToPlaza
    ? SQL` search_distance_to_plaza >= ${nftFilters.minDistanceToPlaza} `
    : null
  const FILTER_BY_MAX_PLAZA_DISTANCE = nftFilters.maxDistanceToPlaza
    ? SQL` search_distance_to_plaza <= ${nftFilters.maxDistanceToPlaza} `
    : null
  const FILTER_BY_ROAD_ADJACENT = nftFilters.adjacentToRoad ? SQL` search_adjacent_to_road = true ` : null
  const FILTER_BY_IDS = nftFilters.ids?.length ? SQL` id = ANY (${nftFilters.ids}) ` : null
  const FILTER_NFT_BY_MIN_PRICE = nftFilters.minPrice ? SQL` nft.search_order_price >= ${nftFilters.minPrice}` : null
  const FILTER_NFT_BY_MAX_PRICE = nftFilters.maxPrice ? SQL` nft.search_order_price <= ${nftFilters.maxPrice}` : null

  const whereClause = getWhereStatementFromFilters([
    FILTER_BY_OWNER,
    FILTER_BY_CATEGORY,
    FILTER_BY_TOKEN_ID,
    FILTER_BY_ITEM_ID,
    FILTER_BY_NETWORK,
    FILTER_BY_WEARABLE_HEAD,
    FILTER_BY_LAND,
    FILTER_BY_WEARABLE_ACCESSORY,
    FILTER_BY_SMART_WEARABLE,
    FILTER_BY_CONTRACT_ADDRESSES,
    FILTER_BY_SEARCH,
    FILTER_BY_MIN_PLAZA_DISTANCE,
    FILTER_BY_MAX_PLAZA_DISTANCE,
    FILTER_BY_ROAD_ADJACENT,
    FILTER_BY_IDS,
    FILTER_NFT_BY_MIN_PRICE,
    FILTER_NFT_BY_MAX_PRICE,
    nftFilters.isLand || nftFilters.category === NFTCategory.PARCEL || nftFilters.category === NFTCategory.ESTATE
      ? SQL`nft.search_estate_size > 0 `
      : null
  ])

  return SQL`
    filtered_nft AS (
      SELECT *
      FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.nft
    `
        .append(whereClause)
        .append(getNFTsSortByStatement(nftFilters.sortBy))
        .append(
          uncapped || nftFilters.sortBy === NFTSortBy.RECENTLY_LISTED || !!nftFilters.owner
            ? SQL``
            : getNFTLimitAndOffsetStatement(nftFilters)
        )
        .append(SQL`)`)
    )
}

function getFilteredEstateCTE(filters: GetNFTsFilters): SQLStatement {
  // we need to fix the squid estate owner id first
  // const FILTER_BY_OWNER = filters.owner
  //   ? SQL` est.owner_id IN (SELECT id FROM squid_marketplace.account WHERE address = ${filters.owner.toLocaleLowerCase()}) `
  //   : null
  const FILTER_MIN_ESTATE_SIZE = filters.minEstateSize ? SQL` est.size >= ${filters.minEstateSize} ` : SQL` est.size > 0 `
  const FILTER_MAX_ESTATE_SIZE = filters.maxEstateSize ? SQL` est.size <= ${filters.maxEstateSize} ` : null
  const FILTER_BY_TOKEN_ID = filters.tokenId ? SQL` est.token_id = ${filters.tokenId} ` : null

  const where = getWhereStatementFromFilters([
    // FILTER_BY_OWNER,
    FILTER_MIN_ESTATE_SIZE,
    FILTER_MAX_ESTATE_SIZE,
    FILTER_BY_TOKEN_ID
  ])

  return SQL`
    , filtered_estate AS (
      SELECT
        est.id,
        est.token_id,
        est.size,
        est.data_id,
        ARRAY_AGG(
          JSON_BUILD_OBJECT('x', est_parcel.x, 'y', est_parcel.y)
        ) AS estate_parcels
      FROM
        `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.estate est
      LEFT JOIN `
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`.parcel est_parcel ON est.id = est_parcel.estate_id
      `.append(where).append(SQL`
      GROUP BY
        est.id, est.token_id, est.size, est.data_id
      )
  `)
        )
    )
}

function getParcelEstateDataCTE(filters: GetNFTsFilters): SQLStatement {
  // const FILTER_BY_OWNER = filters.owner
  //   ? SQL` (par_est.owner_id IN (SELECT id FROM squid_marketplace.account WHERE address = ${filters.owner.toLocaleLowerCase()}) OR par.owner_id IN (SELECT id FROM squid_marketplace.account WHERE address = ${filters.owner.toLocaleLowerCase()})) `
  //   : null
  const FILTER_BY_TOKEN_ID = filters.tokenId ? SQL` (par.token_id = ${filters.tokenId} OR par_est.token_id = ${filters.tokenId}) ` : null
  const where = getWhereStatementFromFilters([
    // FILTER_BY_OWNER,
    FILTER_BY_TOKEN_ID
  ])
  return SQL`
    , parcel_estate_data AS (
      SELECT
        par.*,
        par_est.token_id AS parcel_estate_token_id,
        est_data.name AS parcel_estate_name
      FROM
        `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.parcel par
      LEFT JOIN `
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`.estate par_est ON par.estate_id = par_est.id AND par_est.size > 0
      LEFT JOIN `
            .append(MARKETPLACE_SQUID_SCHEMA)
            .append(
              SQL`.data est_data ON par_est.data_id = est_data.id
      `
            )
            .append(where)
            .append(SQL`)`)
        )
    )
}

export function getNFTLimitAndOffsetStatement(nftFilters?: GetNFTsFilters) {
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
    case NFTSortBy.RECENTLY_SOLD:
      return SQL` ORDER BY sold_at DESC `
    default:
      return SQL``
  }
}

export function getMainQuerySortByStatement(sortBy?: NFTSortBy) {
  switch (sortBy) {
    case NFTSortBy.RECENTLY_LISTED:
      return SQL` ORDER BY order_created_at DESC `
    case NFTSortBy.NAME:
      return SQL` ORDER BY name ASC `
    case NFTSortBy.NEWEST:
      return SQL` ORDER BY created_at DESC `
    case NFTSortBy.RECENTLY_SOLD:
      return SQL` ORDER BY sold_at DESC `
    default:
      return SQL``
  }
}

export function getNFTsQuery(nftFilters: GetNFTsFilters & { rentalAssetsIds?: string[] } = {}, uncapped = false): SQLStatement {
  // The Recently Listed sort by is handled by a different CTE because it needs to join with the trades table
  if (nftFilters.isLand || nftFilters.category === NFTCategory.PARCEL || nftFilters.category === NFTCategory.ESTATE) {
    return nftFilters.isOnSale ? getLandsOnSaleQuery(nftFilters) : getAllLANDsQuery(nftFilters)
  } else if (nftFilters.category === NFTCategory.ENS) {
    return getENSs(nftFilters, uncapped)
  } else if (nftFilters.sortBy === NFTSortBy.RECENTLY_LISTED) {
    return getRecentlyListedNFTsQuery(nftFilters)
  }

  return getTradesCTE({
    cteName: 'trades',
    sortBy: nftFilters.sortBy,
    first: nftFilters.first,
    skip: nftFilters.skip,
    category: nftFilters.category
  })
    .append(getFilteredEstateCTE(nftFilters))
    .append(getParcelEstateDataCTE(nftFilters))
    .append(SQL`, `)
    .append(getFilteredNFTCTE(nftFilters, uncapped))
    .append(
      SQL`
    SELECT
      COUNT(*) OVER() AS count,
      nft.id,
      nft.contract_address,
      nft.token_id,
      nft.network,
      nft.created_at,
      nft.token_uri AS url,
      nft.updated_at,
      nft.sold_at,
      nft.urn,
      COALESCE(nft.search_order_price, (trades.assets -> 'received' ->> 'amount')::numeric(78)) as price,
      account.address AS owner,
      nft.image,
      nft.issued_id,
      item.blockchain_id AS item_id,
      nft.category,
      COALESCE(wearable.rarity, emote.rarity) AS rarity,
      COALESCE(
        wearable.name,
        emote.name,
        land_data."name",
        ens.subdomain
      ) AS name,
      parcel.x,
      parcel.y,
      ens.subdomain,
      wearable.body_shapes,
      wearable.category AS wearable_category,
      emote.category AS emote_category,
      nft.item_type,
      emote.loop,
      emote.has_sound,
      emote.has_geometry,
      estate.estate_parcels,
      estate.size AS size,
      parcel.parcel_estate_token_id,
      parcel.parcel_estate_name,
      parcel.estate_id AS parcel_estate_id,
      COALESCE(
        wearable.description,
        emote.description,
        land_data.description
      ) AS description,
       coalesce (to_timestamp(nft.search_order_created_at), trades.created_at) as order_created_at
    FROM
      filtered_nft nft
    LEFT JOIN `
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`.metadata metadata ON nft.metadata_id = metadata.id
    LEFT JOIN `
            .append(MARKETPLACE_SQUID_SCHEMA)
            .append(
              SQL`.wearable wearable ON metadata.wearable_id = wearable.id
    LEFT JOIN `
                .append(MARKETPLACE_SQUID_SCHEMA)
                .append(
                  SQL`.emote emote ON metadata.emote_id = emote.id
    LEFT JOIN parcel_estate_data parcel ON nft.id = parcel.id
    LEFT JOIN filtered_estate estate ON nft.id = estate.id
    LEFT JOIN `
                    .append(MARKETPLACE_SQUID_SCHEMA)
                    .append(
                      SQL`.data land_data ON (
      estate.data_id = land_data.id OR parcel.id = land_data.id
    )
    LEFT JOIN `
                        .append(MARKETPLACE_SQUID_SCHEMA)
                        .append(
                          SQL`.ens ens ON ens.id = nft.ens_id
    LEFT JOIN `
                            .append(MARKETPLACE_SQUID_SCHEMA)
                            .append(
                              SQL`.account account ON nft.owner_id = account.id
    LEFT JOIN `
                                .append(MARKETPLACE_SQUID_SCHEMA)
                                .append(
                                  SQL`.item item ON item.id = nft.item_id
    LEFT JOIN trades ON trades.sent_contract_address = nft.contract_address AND trades.sent_token_id::numeric = nft.token_id AND trades.status = 'open' AND trades.signer = account.address
    `
                                    .append(getNFTWhereStatement(nftFilters))
                                    .append(getMainQuerySortByStatement(nftFilters.sortBy))
                                    .append(uncapped ? SQL`` : getNFTLimitAndOffsetStatement(nftFilters))
                                )
                            )
                        )
                    )
                )
            )
        )
    )
}

export function getNftByTokenIdQuery(contractAddress: string, tokenId: string, network: Network) {
  return getNFTsQuery({ tokenId, network, contractAddresses: [contractAddress] })
}

function getNFTWhereStatement(nftFilters: GetNFTsFilters): SQLStatement {
  if (!nftFilters) {
    return SQL``
  }

  // Keep only filters that need JOINed tables
  const FILTER_BY_HAS_SOUND = nftFilters.emoteHasSound ? SQL` emote.has_sound = true ` : null
  const FILTER_BY_HAS_GEOMETRY = nftFilters.emoteHasGeometry ? SQL` emote.has_geometry = true ` : null
  const FILTER_BY_WEARABLE_CATEGORY = nftFilters.wearableCategory ? SQL` wearable.category = ${nftFilters.wearableCategory} ` : null
  const FILTER_BY_EMOTE_CATEGORY = nftFilters.emoteCategory ? SQL` emote.category = ${nftFilters.emoteCategory} ` : null
  const FILTER_BY_EMOTE_PLAY_MODE = getEmotePlayModeWhereStatement(nftFilters.emotePlayMode)
  const FILTER_BY_EMOTE_GENDERS = getGenderWhereStatement(true, nftFilters.emoteGenders)
  const FILTER_BY_WEARABLE_GENDER = getGenderWhereStatement(false, nftFilters.wearableGenders)
  const creators = nftFilters.creator && (Array.isArray(nftFilters.creator) ? nftFilters.creator : [nftFilters.creator])
  const FILTER_BY_CREATOR =
    creators && creators.length ? SQL` LOWER(item.creator) = ANY(${creators.map(creator => creator.toLowerCase())}) ` : null
  const FITLER_BY_RARITY = getRarityWhereStatement(nftFilters.itemRarities)
  const FILTER_BY_MIN_PRICE = nftFilters.minPrice
    ? SQL` (nft.search_order_price >= ${nftFilters.minPrice} OR (trades.assets -> 'received' ->> 'amount')::numeric(78) >= ${nftFilters.minPrice})`
    : null
  const FILTER_BY_MAX_PRICE = nftFilters.maxPrice
    ? SQL` (nft.search_order_price <= ${nftFilters.maxPrice} OR (trades.assets -> 'received' ->> 'amount')::numeric(78) <= ${nftFilters.maxPrice})`
    : null
  const FILTER_BY_ON_SALE = nftFilters.isOnSale
    ? SQL` (trades.id IS NOT NULL OR (nft.search_order_status = ${ListingStatus.OPEN} AND nft.search_order_expires_at < `.append(
        MAX_ORDER_TIMESTAMP
      ).append(` 
                AND ((LENGTH(nft.search_order_expires_at::text) = 13 AND TO_TIMESTAMP(nft.search_order_expires_at / 1000.0) > NOW())
                      OR
                    (LENGTH(nft.search_order_expires_at::text) = 10 AND TO_TIMESTAMP(nft.search_order_expires_at) > NOW())))) `)
    : null
  const FITLER_BANNED_NAMES =
    nftFilters.bannedNames && nftFilters.bannedNames.length
      ? SQL` (nft.category != ${NFTCategory.ENS} OR nft.name <> ALL (${nftFilters.bannedNames})) `
      : null

  return getWhereStatementFromFilters([
    FILTER_BY_HAS_SOUND,
    FILTER_BY_HAS_GEOMETRY,
    FILTER_BY_EMOTE_CATEGORY,
    FILTER_BY_WEARABLE_CATEGORY,
    FILTER_BY_EMOTE_PLAY_MODE,
    FILTER_BY_EMOTE_GENDERS,
    FILTER_BY_WEARABLE_GENDER,
    FILTER_BY_CREATOR,
    FITLER_BY_RARITY,
    FILTER_BY_MIN_PRICE,
    FILTER_BY_MAX_PRICE,
    FILTER_BY_ON_SALE,
    FITLER_BANNED_NAMES
  ])
}

function getRecentlyListedNFTsQuery(nftFilters: GetNFTsFilters): SQLStatement {
  const ownerEthereumAddress = nftFilters.owner ? `${nftFilters.owner.toLocaleLowerCase()}-ETHEREUM` : null
  const ownerPolygonAddress = nftFilters.owner ? `${nftFilters.owner.toLocaleLowerCase()}-POLYGON` : null
  const FILTER_BY_OWNER = nftFilters.owner ? SQL` owner_id = ${ownerEthereumAddress} OR owner_id = ${ownerPolygonAddress} ` : null
  const FILTER_BY_CATEGORY = nftFilters.category ? SQL` category = ${nftFilters.category.toLowerCase()} ` : null
  const FILTER_BY_TOKEN_ID = nftFilters.tokenId ? SQL` token_id = ${nftFilters.tokenId} ` : null
  const FILTER_BY_ITEM_ID = nftFilters.itemId ? SQL` LOWER(item_id) = LOWER(${nftFilters.itemId}) ` : null
  const FILTER_BY_NETWORK = nftFilters.network ? SQL` network = ANY (${getDBNetworks(nftFilters.network)}) ` : null
  const FILTER_BY_WEARABLE_HEAD = nftFilters.isWearableHead ? SQL` search_is_wearable_head = true ` : null
  const FILTER_BY_LAND = nftFilters.isLand ? SQL` search_is_land = true ` : null
  const FILTER_BY_WEARABLE_ACCESSORY = nftFilters.isWearableAccessory ? SQL` search_is_wearable_accessory = true ` : null
  const FILTER_BY_SMART_WEARABLE = nftFilters.isWearableSmart ? SQL` item_type = ${ItemType.SMART_WEARABLE_V1} ` : null
  const FILTER_BY_CONTRACT_ADDRESSES = nftFilters.contractAddresses?.length
    ? SQL` contract_address = ANY (${nftFilters.contractAddresses}) `
    : null
  const FILTER_BY_SEARCH = nftFilters.search ? SQL` search_text % ${nftFilters.search} ` : null
  const FILTER_BY_MIN_PLAZA_DISTANCE = nftFilters.minDistanceToPlaza
    ? SQL` search_distance_to_plaza >= ${nftFilters.minDistanceToPlaza} `
    : null
  const FILTER_BY_MAX_PLAZA_DISTANCE = nftFilters.maxDistanceToPlaza
    ? SQL` search_distance_to_plaza <= ${nftFilters.maxDistanceToPlaza} `
    : null
  const FILTER_BY_ROAD_ADJACENT = nftFilters.adjacentToRoad ? SQL` search_adjacent_to_road = true ` : null
  const FILTER_BY_IDS = nftFilters.ids?.length ? SQL` id = ANY (${nftFilters.ids}) ` : null

  const FILTER_BY_ON_SALE = nftFilters.isOnSale
    ? SQL` (nft.search_order_status = ${ListingStatus.OPEN} AND nft.search_order_expires_at < `.append(MAX_ORDER_TIMESTAMP).append(` 
                AND ((LENGTH(nft.search_order_expires_at::text) = 13 AND TO_TIMESTAMP(nft.search_order_expires_at / 1000.0) > NOW())
                      OR
                    (LENGTH(nft.search_order_expires_at::text) = 10 AND TO_TIMESTAMP(nft.search_order_expires_at) > NOW())) )`)
    : null

  const FILTER_NFT_BY_MIN_PRICE = nftFilters.minPrice ? SQL` nft.search_order_price >= ${nftFilters.minPrice}` : null
  const FILTER_NFT_BY_MAX_PRICE = nftFilters.maxPrice ? SQL` nft.search_order_price <= ${nftFilters.maxPrice}` : null

  const FILTER_TRADES_BY_MIN_PRICE = nftFilters.minPrice
    ? SQL` trades.assets -> 'received' ->> 'amount')::numeric(78) >= ${nftFilters.minPrice}`
    : null
  const FILTER_TRADES_BY_MAX_PRICE = nftFilters.maxPrice
    ? SQL` trades.assets -> 'received' ->> 'amount')::numeric(78) <= ${nftFilters.maxPrice}`
    : null

  const filters = [
    FILTER_BY_OWNER,
    FILTER_BY_CATEGORY,
    FILTER_BY_TOKEN_ID,
    FILTER_BY_ITEM_ID,
    FILTER_BY_NETWORK,
    FILTER_BY_WEARABLE_HEAD,
    FILTER_BY_LAND,
    FILTER_BY_WEARABLE_ACCESSORY,
    FILTER_BY_SMART_WEARABLE,
    FILTER_BY_CONTRACT_ADDRESSES,
    FILTER_BY_SEARCH,
    FILTER_BY_MIN_PLAZA_DISTANCE,
    FILTER_BY_MAX_PLAZA_DISTANCE,
    FILTER_BY_ROAD_ADJACENT,
    FILTER_BY_IDS
  ]

  const whereClauseForTradeNFTsIds = getWhereStatementFromFilters([...filters, FILTER_TRADES_BY_MIN_PRICE, FILTER_TRADES_BY_MAX_PRICE])
  const whereClauseForNFTsWithOrders = getWhereStatementFromFilters([
    ...filters,
    FILTER_BY_ON_SALE,
    FILTER_NFT_BY_MIN_PRICE,
    FILTER_NFT_BY_MAX_PRICE
  ])
  const whereClauseForNFTsWithTrades = getWhereStatementFromFilters([...filters, SQL`nft.id IN (SELECT nft_id FROM recent_trade_nft_ids)`])

  return getTradesCTE({ sortBy: nftFilters.sortBy, first: nftFilters.first, skip: nftFilters.skip, category: nftFilters.category }).append(
    SQL`
    , recent_trade_nft_ids AS (
      SELECT DISTINCT ON (assets_with_values.nft_id)
        assets_with_values.nft_id,
        t.created_at
      FROM unified_trades t
      JOIN (
        SELECT
          ta.trade_id,
          nft.id AS nft_id
        FROM marketplace.trade_assets ta
        LEFT JOIN marketplace.trade_assets_erc721 erc721_asset ON ta.id = erc721_asset.asset_id
        LEFT JOIN `
      .append(MARKETPLACE_SQUID_SCHEMA)
      .append(
        SQL`.nft nft ON (
          ta.contract_address = nft.contract_address
          AND erc721_asset.token_id::numeric = nft.token_id
        )
        `
          .append(whereClauseForTradeNFTsIds)
          .append(
            SQL`
      ) assets_with_values ON t.id = assets_with_values.trade_id
      WHERE t.type = 'public_nft_order'
      ORDER BY assets_with_values.nft_id, t.created_at DESC
    ),
    nfts_with_trades AS (
      SELECT 
        nft.*,
        unified_trades.created_at AS trade_created_at,
        unified_trades.assets,
        'trade' AS reason
      FROM `
              .append(MARKETPLACE_SQUID_SCHEMA)
              .append(
                SQL`.nft nft
      LEFT JOIN unified_trades ON (
        unified_trades.assets -> 'sent' ->> 'token_id' = nft.token_id::TEXT
        AND unified_trades.assets -> 'sent' ->> 'contract_address' = nft.contract_address
      )
            `
                  .append(whereClauseForNFTsWithTrades)
                  .append(
                    SQL`
      ORDER BY unified_trades.created_at DESC `
                      .append(getNFTLimitAndOffsetStatement(nftFilters))
                      .append(
                        SQL`
    ),
    filtered_orders AS (
      SELECT nft_id
      FROM `
                          .append(MARKETPLACE_SQUID_SCHEMA)
                          .append(
                            SQL`."order"
      WHERE 
        status = 'open' 
        AND expires_at_normalized > NOW()
        `
                              .append(
                                nftFilters.isLand
                                  ? SQL` AND (category = 'parcel' OR category = 'estate') `
                                  : nftFilters.category
                                  ? SQL` AND category = ${nftFilters.category.toLocaleLowerCase()} `
                                  : SQL``
                              )
                              .append(
                                SQL`
      ORDER BY expires_at_normalized DESC NULLS LAST
      LIMIT 24
    ),
    nfts_with_orders AS (
      SELECT 
        nft.*,
        NULL::timestamp AS trade_created_at,
        NULL::json AS trade_assets,
        'order' AS reason
      FROM `
                                  .append(MARKETPLACE_SQUID_SCHEMA)
                                  .append(
                                    SQL`.nft
      JOIN filtered_orders ON nft.id = filtered_orders.nft_id
      `
                                      .append(whereClauseForNFTsWithOrders)
                                      .append(
                                        SQL`
      ORDER BY search_order_created_at DESC NULLS LAST `
                                          .append(getNFTLimitAndOffsetStatement(nftFilters))
                                          .append(
                                            SQL` 
    )
    SELECT
      combined.id,
      combined.contract_address,
      combined.token_id,
      combined.network,
      combined.created_at,
      combined.token_uri AS url,
      combined.updated_at,
      combined.sold_at,
      combined.urn,
      COALESCE(combined.search_order_price, (combined.assets -> 'received' ->> 'amount')::numeric(78)) AS price,
      account.address AS owner,
      combined.image,
      combined.issued_id,
      item.blockchain_id AS item_id,
      combined.category,
      COALESCE(wearable.rarity, emote.rarity) AS rarity,
      COALESCE(wearable.name, emote.name, land_data."name", ens.subdomain) AS name,
      parcel.x,
      parcel.y,
      ens.subdomain,
      wearable.body_shapes,
      wearable.category AS wearable_category,
      emote.category AS emote_category,
      combined.item_type,
      emote.loop,
      emote.has_sound,
      emote.has_geometry,
      estate.estate_parcels,
      estate.size AS size,
      parcel.parcel_estate_token_id,
      parcel.parcel_estate_name,
      parcel.estate_id AS parcel_estate_id,
      COALESCE(wearable.description, emote.description, land_data.description) AS description,
      COALESCE(TO_TIMESTAMP(combined.search_order_created_at), combined.trade_created_at) AS order_created_at,
      combined.reason          
    FROM (
      SELECT 
        *,
        COALESCE(
          TO_TIMESTAMP(search_order_created_at),
          trade_created_at
        ) AS sort_field
      FROM nfts_with_trades
      UNION ALL
      SELECT 
        *,
        COALESCE(
          TO_TIMESTAMP(search_order_created_at),
          trade_created_at
        ) AS sort_field
      FROM nfts_with_orders
    ) combined
    LEFT JOIN `
                                              .append(MARKETPLACE_SQUID_SCHEMA)
                                              .append(
                                                SQL`.metadata metadata ON combined.metadata_id = metadata.id
    LEFT JOIN `
                                                  .append(MARKETPLACE_SQUID_SCHEMA)
                                                  .append(
                                                    SQL`.wearable wearable ON metadata.wearable_id = wearable.id
    LEFT JOIN `
                                                      .append(MARKETPLACE_SQUID_SCHEMA)
                                                      .append(
                                                        SQL`.emote emote ON metadata.emote_id = emote.id
    LEFT JOIN (
      SELECT par.*, par_est.token_id AS parcel_estate_token_id, est_data.name AS parcel_estate_name
      FROM `
                                                          .append(MARKETPLACE_SQUID_SCHEMA)
                                                          .append(
                                                            SQL`.parcel par
      LEFT JOIN `
                                                              .append(MARKETPLACE_SQUID_SCHEMA)
                                                              .append(
                                                                SQL`.estate par_est ON par.estate_id = par_est.id
      LEFT JOIN `
                                                                  .append(MARKETPLACE_SQUID_SCHEMA)
                                                                  .append(
                                                                    SQL`.data est_data ON par_est.data_id = est_data.id
    ) AS parcel ON combined.id = parcel.id
    LEFT JOIN (
      SELECT est.id, est.token_id, est.size, est.data_id, array_agg(json_build_object('x', est_parcel.x, 'y', est_parcel.y)) AS estate_parcels
      FROM `
                                                                      .append(MARKETPLACE_SQUID_SCHEMA)
                                                                      .append(
                                                                        SQL`.estate est
      LEFT JOIN `
                                                                          .append(MARKETPLACE_SQUID_SCHEMA)
                                                                          .append(
                                                                            SQL`.parcel est_parcel ON est.id = est_parcel.estate_id
      GROUP BY est.id, est.token_id, est.size, est.data_id
    ) AS estate ON combined.id = estate.id
    LEFT JOIN `
                                                                              .append(MARKETPLACE_SQUID_SCHEMA)
                                                                              .append(
                                                                                SQL`.data land_data ON (estate.data_id = land_data.id OR parcel.id = land_data.id)
    LEFT JOIN `
                                                                                  .append(MARKETPLACE_SQUID_SCHEMA)
                                                                                  .append(
                                                                                    SQL`.ens ens ON ens.id = combined.ens_id
    LEFT JOIN `
                                                                                      .append(MARKETPLACE_SQUID_SCHEMA)
                                                                                      .append(
                                                                                        SQL`.account account ON combined.owner_id = account.id
    LEFT JOIN `
                                                                                          .append(MARKETPLACE_SQUID_SCHEMA)
                                                                                          .append(
                                                                                            SQL`.item item ON item.id = combined.item_id
    ORDER BY sort_field DESC
    `.append(getNFTLimitAndOffsetStatement(nftFilters)).append(SQL`
    `)
                                                                                          )
                                                                                      )
                                                                                  )
                                                                              )
                                                                          )
                                                                      )
                                                                  )
                                                              )
                                                          )
                                                      )
                                                  )
                                              )
                                          )
                                      )
                                  )
                              )
                          )
                      )
                  )
              )
          )
      )
  )
}
