import SQL, { SQLStatement } from 'sql-template-strings'
import { NFTSortBy } from '@dcl/schemas'
import { getWhereStatementFromFilters } from '../utils'
import { getNFTLimitAndOffsetStatement, getTradesCTE } from './queries'
import { GetNFTsFilters } from './types'

export function getNFTsSortBy(sortBy?: NFTSortBy) {
  switch (sortBy) {
    case NFTSortBy.NAME:
      return SQL` ORDER BY name ASC `
    case NFTSortBy.NEWEST:
      return SQL` ORDER BY created_at DESC `
    case NFTSortBy.CHEAPEST:
      return SQL` ORDER BY coalesce((trades.assets -> 'received' ->> 'amount')::numeric(78), nft.search_order_price) ASC `
    case NFTSortBy.RECENTLY_LISTED:
      return SQL` ORDER BY GREATEST(to_timestamp(nft.search_order_created_at), trades.created_at) DESC NULLS LAST `
    case NFTSortBy.RECENTLY_SOLD:
      return SQL` ORDER BY sold_at DESC `
    default:
      return SQL` ORDER BY created_at DESC`
  }
}

function getLANDWhereStatement(nftFilters: GetNFTsFilters): SQLStatement {
  if (!nftFilters) {
    return SQL``
  }

  // Keep only filters that need JOINed tables
  const FILTER_BY_OWNER = nftFilters.owner
    ? SQL` nft.owner_id IN (SELECT id FROM squid_marketplace.account WHERE address = ${nftFilters.owner.toLocaleLowerCase()}) `
    : null
  const FILTER_MIN_ESTATE_SIZE = nftFilters.minEstateSize
    ? SQL` estate.size >= ${nftFilters.minEstateSize} `
    : SQL` (estate.size IS NULL OR estate.size > 0) `
  const FILTER_MAX_ESTATE_SIZE = nftFilters.maxEstateSize ? SQL` estate.size <= ${nftFilters.maxEstateSize} ` : null
  const FILTER_BY_MIN_PRICE = nftFilters.minPrice
    ? SQL` (nft.search_order_price >= ${nftFilters.minPrice} OR (trades.assets -> 'received' ->> 'amount')::numeric(78) >= ${nftFilters.minPrice})`
    : null
  const FILTER_BY_MAX_PRICE = nftFilters.maxPrice
    ? SQL` (nft.search_order_price <= ${nftFilters.maxPrice} OR (trades.assets -> 'received' ->> 'amount')::numeric(78) <= ${nftFilters.maxPrice})`
    : null
  const FILTER_BY_ON_SALE = nftFilters.isOnSale ? SQL` (trades.id IS NOT NULL OR orders.nft_id IS NOT NULL)` : null

  // @TODO DEBUG WHY THIS FILTERS ARE SLOWING DOWN THE QUERY AND ENABLE THEM BACK
  // const FILTER_BY_MIN_PLAZA_DISTANCE = nftFilters.minDistanceToPlaza
  //   ? SQL` search_distance_to_plaza >= ${nftFilters.minDistanceToPlaza} `
  //   : null

  // const FILTER_BY_MAX_PLAZA_DISTANCE = nftFilters.maxDistanceToPlaza
  //   ? SQL` search_distance_to_plaza <= ${nftFilters.maxDistanceToPlaza} `
  //   : null

  // const FILTER_BY_ROAD_ADJACENT = nftFilters.adjacentToRoad ? SQL` search_adjacent_to_road = true ` : null

  return getWhereStatementFromFilters([
    FILTER_BY_OWNER,
    FILTER_MIN_ESTATE_SIZE,
    FILTER_MAX_ESTATE_SIZE,
    FILTER_BY_MIN_PRICE,
    FILTER_BY_MAX_PRICE,
    FILTER_BY_ON_SALE
    // FILTER_BY_MIN_PLAZA_DISTANCE,
    // FILTER_BY_MAX_PLAZA_DISTANCE,
    // FILTER_BY_ROAD_ADJACENT
  ])
}

export function getLANDs(nftFilters: GetNFTsFilters): SQLStatement {
  const { sortBy, isOnSale, ids } = nftFilters
  return SQL`
      WITH filtered_land_nfts AS (
          SELECT *
          FROM squid_marketplace.nft
          WHERE  search_is_land = true `
    .append(ids ? SQL` AND id = ANY(${ids}) ` : SQL``)
    .append(
      SQL`
          ORDER BY created_at 
      ), 
      filtered_estate AS (
          SELECT
            est.id,
            est.token_id,
            est.size,
            est.data_id,
            array_agg(json_build_object('x', est_parcel.x, 'y', est_parcel.y)) AS estate_parcels
        FROM
          squid_marketplace.estate est
          LEFT JOIN squid_marketplace.parcel est_parcel ON est.id = est_parcel.estate_id
        GROUP BY
          est.id,
          est.token_id,
          est.size,
          est.data_id
        ),
        parcel_estate_data AS (
          SELECT
            par.*,
            par_est.token_id AS parcel_estate_token_id,
            est_data.name AS parcel_estate_name
          FROM
            squid_marketplace.parcel par
            LEFT JOIN squid_marketplace.estate par_est ON par.estate_id = par_est.id
            LEFT JOIN squid_marketplace.data est_data ON par_est.data_id = est_data.id
        )
        `
        .append(getTradesCTE(nftFilters))
        .append(
          SQL`
        `
        )
        .append(
          isOnSale
            ? SQL`
        , valid_orders AS (
          SELECT
            o.nft_id,
            o.status,
            o.expires_normalized
          FROM
            squid_marketplace.order o
          WHERE
            o.status = 'open'
            AND o.expires_normalized > now()
        )`
            : SQL``
        )
        .append(
          SQL`
        SELECT
          count(*) OVER () AS count,
          nft.id,
          nft.contract_address,
          nft.token_id,
          nft.network,
          nft.created_at,
          nft.token_uri AS url,
          nft.updated_at,
          nft.sold_at,
          nft.urn,
          CASE 
		        WHEN (trades.assets -> 'received' ->> 'amount') IS NOT NULL THEN (trades.assets -> 'received' ->> 'amount')::numeric(78)
		        ELSE nft.search_order_price
		      END AS price,
          nft.owner_id,
          nft.image,
          nft.issued_id,
          -- item.blockchain_id AS item_id,
          nft.category,
          nft.name,
          parcel.x,
          parcel.y,
          nft.item_type,
          estate.estate_parcels,
          estate.size AS size,
          parcel.parcel_estate_token_id,
          parcel.parcel_estate_name,
          parcel.estate_id AS parcel_estate_id,
          --      COALESCE(
          --        wearable.description,
          --        emote.description,
          --        land_data.description
          --      ) AS description,
          GREATEST(to_timestamp(nft.search_order_created_at), trades.created_at) as order_created_at
          FROM
              filtered_land_nfts nft
        LEFT JOIN parcel_estate_data parcel ON nft.id = parcel.id
        LEFT JOIN filtered_estate estate ON nft.id = estate.id
        --    LEFT JOIN squid_marketplace.data land_data ON (
        --      estate.data_id = land_data.id OR parcel.id = land_data.id
        --    )
        LEFT JOIN trades ON (trades.assets -> 'sent' ->> 'token_id')::numeric = nft.token_id
            AND trades.assets -> 'sent' ->> 'contract_address' = nft.contract_address
            AND trades.status = 'open'
      --    AND trades.signer = account.address
            `
            .append(isOnSale ? SQL`LEFT JOIN valid_orders orders ON orders.nft_id = nft.id` : SQL``)
            .append(getLANDWhereStatement(nftFilters))
            .append(getNFTsSortBy(sortBy))
            .append(getNFTLimitAndOffsetStatement(nftFilters)).append(SQL`;
            `)
        )
    )
}
