import SQL, { SQLStatement } from 'sql-template-strings'
import { EmotePlayMode, GenderFilterOption, ListingStatus, Network, NFTCategory, NFTSortBy, Rarity, WearableGender } from '@dcl/schemas'
import { getDBNetworks } from '../../utils'
import { MAX_ORDER_TIMESTAMP } from '../catalog/queries'
import { ItemType } from '../items'
import { getWhereStatementFromFilters } from '../utils'
import { getENSs } from './ensQueries'
import { getLANDs } from './landQueries'
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
  // Define each filter condition separately
  const FILTER_BY_OWNER = nftFilters.owner
    ? SQL` owner_id IN (SELECT id FROM squid_marketplace.account WHERE address = ${nftFilters.owner.toLocaleLowerCase()}) `
    : null
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
    FILTER_NFT_BY_MAX_PRICE
  ])

  return SQL`
    WITH filtered_nft AS (
      SELECT *
      FROM squid_marketplace.nft
    `
    .append(whereClause)
    .append(getNFTsSortByStatement(nftFilters.sortBy))
    .append(
      uncapped || nftFilters.sortBy === NFTSortBy.RECENTLY_LISTED || !!nftFilters.owner ? SQL`` : getNFTLimitAndOffsetStatement(nftFilters)
    )
    .append(SQL`)`)
}

function getFilteredEstateCTE(filters: GetNFTsFilters): SQLStatement {
  const FILTER_BY_OWNER = filters.owner
    ? SQL` est.owner_id IN (SELECT id FROM squid_marketplace.account WHERE address = ${filters.owner.toLocaleLowerCase()}) `
    : SQL``
  const FILTER_MIN_ESTATE_SIZE = filters.minEstateSize ? SQL` est.size >= ${filters.minEstateSize} ` : SQL` est.size > 0 `

  const FILTER_MAX_ESTATE_SIZE = filters.maxEstateSize ? SQL` est.size <= ${filters.maxEstateSize} ` : null

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
        squid_marketplace.estate est
      LEFT JOIN squid_marketplace.parcel est_parcel ON est.id = est_parcel.estate_id
      `.append(getWhereStatementFromFilters([FILTER_BY_OWNER, FILTER_MIN_ESTATE_SIZE, FILTER_MAX_ESTATE_SIZE])).append(SQL`
      GROUP BY
        est.id, est.token_id, est.size, est.data_id
      )
  `)
}

function getParcelEstateDataCTE(filters: GetNFTsFilters): SQLStatement {
  return SQL`
    , parcel_estate_data AS (
      SELECT
        par.*,
        par_est.token_id AS parcel_estate_token_id,
        est_data.name AS parcel_estate_name
      FROM
        squid_marketplace.parcel par
      LEFT JOIN squid_marketplace.estate par_est ON par.estate_id = par_est.id
      LEFT JOIN squid_marketplace.data est_data ON par_est.data_id = est_data.id
      `.append(
    filters.owner
      ? SQL`WHERE (par_est.owner_id IN (SELECT id FROM squid_marketplace.account WHERE address = ${filters.owner.toLocaleLowerCase()}) OR par.owner_id IN (SELECT id FROM squid_marketplace.account WHERE address = ${filters.owner.toLocaleLowerCase()})) `
      : SQL``
  ).append(SQL`
    )
  `)
}

export function getTradesCTE(filters: GetNFTsFilters): SQLStatement {
  return SQL`
    , trades AS (
      SELECT
        t.id,
        t.created_at,
        t.signer,
        t.expires_at,
        t.checks,
        t.network,
        t.chain_id,
        COUNT(*) OVER() as count,
        json_object_agg(assets_with_values.direction, json_build_object(
          'contract_address', assets_with_values.contract_address,
          'direction', assets_with_values.direction,
          'beneficiary', assets_with_values.beneficiary,
          'extra', assets_with_values.extra,
          'token_id', assets_with_values.token_id, 
          'item_id', assets_with_values.item_id,
          'amount', assets_with_values.amount,
          'creator', assets_with_values.creator,
          'owner', assets_with_values.owner,
          'category', assets_with_values.category,
          'nft_id', assets_with_values.nft_id,
          'issued_id', assets_with_values.issued_id,
          'nft_name', assets_with_values.nft_name
        )) as assets,
        CASE
          WHEN COUNT(CASE WHEN trade_status.action = 'cancelled' THEN 1 END) > 0 THEN 'cancelled'
          WHEN (
            (signer_signature_index.index IS NOT NULL AND signer_signature_index.index != (t.checks ->> 'signerSignatureIndex')::int)
            OR (signer_signature_index.index IS NULL AND (t.checks ->> 'signerSignatureIndex')::int != 0)
          ) THEN 'cancelled'
          WHEN (t.expires_at < now()::timestamptz(3)) THEN 'cancelled'
          WHEN (
            (contract_signature_index.index IS NOT NULL AND contract_signature_index.index != (t.checks ->> 'contractSignatureIndex')::int)
            OR (contract_signature_index.index IS NULL AND (t.checks ->> 'contractSignatureIndex')::int != 0)
          ) THEN 'cancelled'
          WHEN COUNT(CASE WHEN trade_status.action = 'executed' THEN 1 END) >= (t.checks ->> 'uses')::int then 'sold'
        ELSE 'open'
        END AS status
      FROM marketplace.trades as t
      JOIN (
        SELECT
          ta.trade_id,
          ta.contract_address,
          ta.direction,
          ta.beneficiary,
          ta.extra,
          erc721_asset.token_id,
          coalesce(item_asset.item_id, nft.item_blockchain_id::text) as item_id,
          erc20_asset.amount,
          item.creator,
          account.address as owner,
          nft.category,
          nft.id as nft_id,
          nft.issued_id as issued_id,
          nft.name as nft_name
        FROM marketplace.trade_assets as ta 
        LEFT JOIN marketplace.trade_assets_erc721 as erc721_asset ON ta.id = erc721_asset.asset_id
        LEFT JOIN marketplace.trade_assets_erc20 as erc20_asset ON ta.id = erc20_asset.asset_id
        LEFT JOIN marketplace.trade_assets_item as item_asset ON ta.id = item_asset.asset_id
        LEFT JOIN squid_marketplace.item as item ON (ta.contract_address = item.collection_id AND item_asset.item_id::numeric = item.blockchain_id)
        LEFT JOIN squid_marketplace.nft as nft ON (ta.contract_address = nft.contract_address AND erc721_asset.token_id::numeric = nft.token_id)
        LEFT JOIN squid_marketplace.account as account ON (account.id = nft.owner_id)
      ) as assets_with_values ON t.id = assets_with_values.trade_id
      LEFT JOIN squid_trades.trade as trade_status ON trade_status.signature = t.hashed_signature
      LEFT JOIN squid_trades.signature_index as signer_signature_index ON LOWER(signer_signature_index.address) = LOWER(t.signer)
      LEFT JOIN (select * from squid_trades.signature_index signature_index where LOWER(signature_index.address) IN ('0x2d6b3508f9aca32d2550f92b2addba932e73c1ff','0x540fb08edb56aae562864b390542c97f562825ba')) as contract_signature_index ON t.network = contract_signature_index.network
      WHERE t.type = 'public_nft_order' `.append(filters.owner ? SQL` AND t.signer = ${filters.owner.toLocaleLowerCase()} ` : SQL``)
    .append(SQL`
      GROUP BY t.id, t.created_at, t.network, t.chain_id, t.signer, t.checks, contract_signature_index.index, signer_signature_index.index
    )
  `)
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

export function getNFTsQuery(nftFilters: GetNFTsFilters = {}, uncapped = false): SQLStatement {
  // The Recently Listed sort by is handled by a different CTE because it needs to join with the trades table
  if (nftFilters.isLand) {
    return getLANDs(nftFilters)
  } else if (nftFilters.category === NFTCategory.ENS) {
    return getENSs(nftFilters)
  } else if (nftFilters.sortBy === NFTSortBy.RECENTLY_LISTED) {
    return getRecentlyListedNFTsCTE(nftFilters)
  }

  return getFilteredNFTCTE(nftFilters, uncapped)
    .append(getFilteredEstateCTE(nftFilters))
    .append(getParcelEstateDataCTE(nftFilters))
    .append(getTradesCTE(nftFilters))
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
    LEFT JOIN squid_marketplace.metadata metadata ON nft.metadata_id = metadata.id
    LEFT JOIN squid_marketplace.wearable wearable ON metadata.wearable_id = wearable.id
    LEFT JOIN squid_marketplace.emote emote ON metadata.emote_id = emote.id
    LEFT JOIN parcel_estate_data parcel ON nft.id = parcel.id
    LEFT JOIN filtered_estate estate ON nft.id = estate.id
    LEFT JOIN squid_marketplace.data land_data ON (
      estate.data_id = land_data.id OR parcel.id = land_data.id
    )
    LEFT JOIN squid_marketplace.ens ens ON ens.id = nft.ens_id
    LEFT JOIN squid_marketplace.account account ON nft.owner_id = account.id
    LEFT JOIN squid_marketplace.item item ON item.id = nft.item_id
    LEFT JOIN trades ON trades.assets -> 'sent' ->> 'token_id' = nft.token_id::text AND trades.assets -> 'sent' ->> 'contract_address' = nft.contract_address AND trades.status = 'open' AND trades.signer = account.address
    `
        .append(getNFTWhereStatement(nftFilters))
        .append(getMainQuerySortByStatement(nftFilters.sortBy))
        .append(uncapped ? SQL`` : getNFTLimitAndOffsetStatement(nftFilters))
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

function getRecentlyListedNFTsCTE(nftFilters: GetNFTsFilters): SQLStatement {
  const FILTER_BY_OWNER = nftFilters.owner
    ? SQL` owner_id IN (SELECT id FROM squid_marketplace.account WHERE address = ${nftFilters.owner.toLocaleLowerCase()}) `
    : null
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

  return SQL`
    WITH trades AS (
      SELECT
        t.id AS trade_id,
        t.created_at AS trade_created_at,
        json_object_agg(
          assets_with_values.direction,
          json_build_object(
            'contract_address', assets_with_values.contract_address,
            'direction', assets_with_values.direction,
            'beneficiary', assets_with_values.beneficiary,
            'extra', assets_with_values.extra,
            'token_id', assets_with_values.token_id, 
            'item_id', assets_with_values.item_id,
            'amount', assets_with_values.amount,
            'creator', assets_with_values.creator,
            'owner', assets_with_values.owner,
            'category', assets_with_values.category,
            'nft_id', assets_with_values.nft_id,
            'issued_id', assets_with_values.issued_id,
            'nft_name', assets_with_values.nft_name
          )
        ) AS assets
      FROM marketplace.trades t
      JOIN (
        SELECT
          ta.trade_id,
          ta.contract_address,
          ta.direction,
          ta.beneficiary,
          ta.extra,
          erc721_asset.token_id,
          COALESCE(item_asset.item_id, nft.item_blockchain_id::TEXT) AS item_id,
          erc20_asset.amount,
          item.creator,
          account.address AS owner,
          nft.category,
          nft.id AS nft_id,
          nft.issued_id AS issued_id,
          nft.name AS nft_name
        FROM marketplace.trade_assets ta
        LEFT JOIN marketplace.trade_assets_erc721 erc721_asset ON ta.id = erc721_asset.asset_id
        LEFT JOIN marketplace.trade_assets_erc20 erc20_asset ON ta.id = erc20_asset.asset_id
        LEFT JOIN marketplace.trade_assets_item item_asset ON ta.id = item_asset.asset_id
        LEFT JOIN squid_marketplace.item item ON ta.contract_address = item.collection_id
          AND item_asset.item_id::numeric = item.blockchain_id
        LEFT JOIN squid_marketplace.nft nft ON ta.contract_address = nft.contract_address
          AND erc721_asset.token_id::numeric = nft.token_id
        LEFT JOIN squid_marketplace.account account ON account.id = nft.owner_id
      ) assets_with_values ON t.id = assets_with_values.trade_id
      WHERE t.type = 'public_nft_order'
      GROUP BY t.id, t.created_at
    ),
    recent_trade_nft_ids AS (
      SELECT DISTINCT ON (assets_with_values.nft_id)
        assets_with_values.nft_id,
        t.created_at
      FROM marketplace.trades t
      JOIN (
        SELECT
          ta.trade_id,
          nft.id AS nft_id
        FROM marketplace.trade_assets ta
        LEFT JOIN marketplace.trade_assets_erc721 erc721_asset ON ta.id = erc721_asset.asset_id
        LEFT JOIN squid_marketplace.nft nft ON (
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
        trades.trade_created_at,
        trades.assets,
        'trade' AS reason
      FROM squid_marketplace.nft nft
      LEFT JOIN trades ON (
        trades.assets -> 'sent' ->> 'token_id' = nft.token_id::TEXT
        AND trades.assets -> 'sent' ->> 'contract_address' = nft.contract_address
      )
            `
        .append(whereClauseForNFTsWithTrades)
        .append(
          SQL`
      ORDER BY trades.trade_created_at DESC `
            .append(getNFTLimitAndOffsetStatement(nftFilters))
            .append(
              SQL`
    ),
    filtered_orders AS (
      SELECT nft_id
      FROM squid_marketplace."order"
      WHERE 
        status = 'open' 
        AND expires_normalized > NOW()
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
      ORDER BY expires_normalized DESC NULLS LAST
      LIMIT 24
    ),
    nfts_with_orders AS (
      SELECT 
        nft.*,
        NULL::timestamp AS trade_created_at,
        NULL::json AS trade_assets,
        'order' AS reason
      FROM squid_marketplace.nft
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
    LEFT JOIN squid_marketplace.metadata metadata ON combined.metadata_id = metadata.id
    LEFT JOIN squid_marketplace.wearable wearable ON metadata.wearable_id = wearable.id
    LEFT JOIN squid_marketplace.emote emote ON metadata.emote_id = emote.id
    LEFT JOIN (
      SELECT par.*, par_est.token_id AS parcel_estate_token_id, est_data.name AS parcel_estate_name
      FROM squid_marketplace.parcel par
      LEFT JOIN squid_marketplace.estate par_est ON par.estate_id = par_est.id
      LEFT JOIN squid_marketplace.data est_data ON par_est.data_id = est_data.id
    ) AS parcel ON combined.id = parcel.id
    LEFT JOIN (
      SELECT est.id, est.token_id, est.size, est.data_id, array_agg(json_build_object('x', est_parcel.x, 'y', est_parcel.y)) AS estate_parcels
      FROM squid_marketplace.estate est
      LEFT JOIN squid_marketplace.parcel est_parcel ON est.id = est_parcel.estate_id
      GROUP BY est.id, est.token_id, est.size, est.data_id
    ) AS estate ON combined.id = estate.id
    LEFT JOIN squid_marketplace.data land_data ON (estate.data_id = land_data.id OR parcel.id = land_data.id)
    LEFT JOIN squid_marketplace.ens ens ON ens.id = combined.ens_id
    LEFT JOIN squid_marketplace.account account ON combined.owner_id = account.id
    LEFT JOIN squid_marketplace.item item ON item.id = combined.item_id
    ORDER BY sort_field DESC
    `.append(getNFTLimitAndOffsetStatement(nftFilters)).append(SQL`
    `)
                        )
                    )
                )
            )
        )
    )
}
