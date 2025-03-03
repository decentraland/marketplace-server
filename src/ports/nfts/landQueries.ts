import SQL, { SQLStatement } from 'sql-template-strings'
import { NFTSortBy } from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getTradesCTE } from '../catalog/queries'
import { getWhereStatementFromFilters } from '../utils'
import { getNFTLimitAndOffsetStatement } from './queries'
import { GetNFTsFilters } from './types'

export function getNFTsSortBy(sortBy?: NFTSortBy) {
  switch (sortBy) {
    case NFTSortBy.NAME:
      return SQL` ORDER BY name ASC `
    case NFTSortBy.NEWEST:
      return SQL` ORDER BY created_at DESC `
    case NFTSortBy.CHEAPEST:
      return SQL` ORDER BY price ASC `
    case NFTSortBy.RECENTLY_LISTED:
      return SQL` ORDER BY order_created_at DESC NULLS LAST `
    case NFTSortBy.RECENTLY_SOLD:
      return SQL` ORDER BY sold_at DESC `
    default:
      return SQL` ORDER BY created_at DESC`
  }
}

function getAllLANDWheres(filters: GetNFTsFilters & { rentalAssetsIds?: string[] }) {
  const {
    owner,
    minDistanceToPlaza,
    maxDistanceToPlaza,
    adjacentToRoad,
    minEstateSize,
    maxEstateSize,
    minPrice,
    maxPrice,
    ids,
    search,
    rentalAssetsIds
  } = filters
  const ownerEthereumAddress = owner ? `${owner.toLocaleLowerCase()}-ETHEREUM` : null
  const ownerPolygonAddress = owner ? `${owner.toLocaleLowerCase()}-POLYGON` : null
  const FILTER_BY_OWNER =
    owner && rentalAssetsIds?.length
      ? SQL` ((nft.owner_id = ${ownerEthereumAddress} OR nft.owner_id = ${ownerPolygonAddress}) OR nft.id = ANY(${rentalAssetsIds})) `
      : owner && !rentalAssetsIds?.length
      ? SQL` (nft.owner_id = ${ownerEthereumAddress} OR nft.owner_id = ${ownerPolygonAddress}) `
      : null
  const FILTER_BY_MIN_PRICE = minPrice
    ? SQL` (nft.search_order_price >= ${minPrice} OR (unified_trades.assets -> 'received' ->> 'amount')::numeric(78) >= ${minPrice})`
    : null
  const FILTER_BY_MIN_TRADE_PRICE = minPrice ? SQL` (unified_trades.assets -> 'received' ->> 'amount')::numeric(78) >= ${minPrice}` : null
  const FILTER_BY_MIN_ORDER_PRICE = minPrice ? SQL` nft.search_order_price >= ${minPrice}` : null
  const FILTER_BY_MAX_PRICE = maxPrice
    ? SQL` (nft.search_order_price <= ${maxPrice} OR (unified_trades.assets -> 'received' ->> 'amount')::numeric(78) <= ${maxPrice})`
    : null
  const FILTER_BY_MAX_TRADE_PRICE = maxPrice ? SQL` (unified_trades.assets -> 'received' ->> 'amount')::numeric(78) <= ${maxPrice}` : null
  const FILTER_BY_MAX_ORDER_PRICE = maxPrice ? SQL` nft.search_order_price <= ${maxPrice}` : null
  const FILTER_BY_MIN_PLAZA_DISTANCE = minDistanceToPlaza ? SQL` search_distance_to_plaza >= ${minDistanceToPlaza} ` : null
  const FILTER_BY_MAX_PLAZA_DISTANCE = maxDistanceToPlaza ? SQL` search_distance_to_plaza <= ${maxDistanceToPlaza} ` : null
  const FILTER_BY_ROAD_ADJACENT = adjacentToRoad ? SQL` search_adjacent_to_road = true ` : null
  const FILTER_MIN_ESTATE_SIZE = minEstateSize ? SQL` search_estate_size >= ${minEstateSize} ` : SQL` search_estate_size > 0 `
  const FILTER_MAX_ESTATE_SIZE = maxEstateSize ? SQL` search_estate_size <= ${maxEstateSize} ` : null
  const FILTER_BY_IDS = ids?.length ? SQL` id = ANY (${ids}) ` : null
  const FILTER_BY_SEARCH = search ? SQL` search_text % ${search} ` : null
  const FILTER_CATEGORY = filters.category ? SQL`category = ${filters.category}` : null

  return {
    FILTER_BY_OWNER,
    FILTER_BY_MIN_PRICE,
    FILTER_BY_MAX_PRICE,
    FILTER_BY_MIN_ORDER_PRICE,
    FILTER_BY_MAX_ORDER_PRICE,
    FILTER_BY_MIN_TRADE_PRICE,
    FILTER_BY_MAX_TRADE_PRICE,
    FILTER_BY_MIN_PLAZA_DISTANCE,
    FILTER_BY_MAX_PLAZA_DISTANCE,
    FILTER_BY_ROAD_ADJACENT,
    FILTER_MIN_ESTATE_SIZE,
    FILTER_MAX_ESTATE_SIZE,
    FILTER_BY_IDS,
    FILTER_BY_SEARCH,
    FILTER_CATEGORY
  }
}

function getOpenOrderNFTsCTE(filters: GetNFTsFilters): SQLStatement {
  const FILTER_IS_ON_SALE = filters.isOnSale
    ? SQL`nft.active_order_id IS NOT NULL AND o.status = 'open' AND o.expires_at_normalized > NOW()`
    : null

  const {
    FILTER_BY_MAX_PLAZA_DISTANCE,
    FILTER_BY_SEARCH,
    FILTER_MAX_ESTATE_SIZE,
    FILTER_MIN_ESTATE_SIZE,
    FILTER_BY_MIN_ORDER_PRICE,
    FILTER_BY_MAX_ORDER_PRICE
  } = getAllLANDWheres(filters)

  const where = getWhereStatementFromFilters([
    SQL`nft.search_is_land = TRUE`,
    filters.category ? SQL`nft.category = ${filters.category}` : null,
    FILTER_IS_ON_SALE,
    FILTER_MIN_ESTATE_SIZE,
    FILTER_MAX_ESTATE_SIZE,
    FILTER_BY_MAX_PLAZA_DISTANCE,
    FILTER_BY_SEARCH,
    FILTER_BY_MIN_ORDER_PRICE,
    FILTER_BY_MAX_ORDER_PRICE
  ])

  return SQL`
    open_orders_nfts AS (
      SELECT 
          nft.id AS nft_id,
          o.price,
          to_timestamp(o.created_at) AS order_created_at
      FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.nft nft
      JOIN `
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`."order" o ON nft.active_order_id = o.id
      `.append(where).append(SQL`
      )
  `)
        )
    )
}

function getOpenTradesCTE(filters: GetNFTsFilters): SQLStatement {
  const { FILTER_BY_MIN_TRADE_PRICE, FILTER_BY_MAX_TRADE_PRICE } = getAllLANDWheres(filters)
  const where = getWhereStatementFromFilters([
    SQL`unified_trades.status = 'open'
        AND (((assets->'sent'->>'nft_id') IS NOT NULL)
          OR ((assets->'received'->>'nft_id') IS NOT NULL))
        AND (((assets->'received'->>'amount') IS NOT NULL)
          OR ((assets->'sent'->>'amount') IS NOT NULL))`,
    FILTER_BY_MIN_TRADE_PRICE,
    FILTER_BY_MAX_TRADE_PRICE
  ])
  return SQL`
    , open_trades AS (
      SELECT
        COALESCE((assets->'received'->>'amount')::numeric(78),
                (assets->'sent'->>'amount')::numeric(78)) AS price,
        COALESCE((assets->'sent'->>'nft_id'),
                (assets->'received'->>'nft_id')) AS nft_id,
        unified_trades.created_at AS trade_created_at
      FROM unified_trades
      `.append(where).append(SQL`
    )
  `)
}

export function getLandsOnSaleQuery(filters: GetNFTsFilters) {
  return getTradesCTE(filters)
    .append(SQL`,`)
    .append(getOpenOrderNFTsCTE(filters))
    .append(getOpenTradesCTE(filters))
    .append(
      SQL`
      , combined AS (
          SELECT nft_id, price, order_created_at AS created_at FROM open_orders_nfts
          UNION
          SELECT nft_id, price, trade_created_at AS created_at FROM open_trades
        ),
        top_nfts AS (
          SELECT 
              COUNT(*) OVER () AS count,
              nft.id,
              nft.contract_address,
              nft.token_id,
              nft.network,
              nft.created_at,
              nft.token_uri AS url,
              nft.updated_at,
              nft.sold_at,
              nft.urn,
              combined.price,
              nft.owner_id,
              nft.image,
              nft.issued_id,
              nft.category,
              nft.name,
              nft.item_type,
              GREATEST(to_timestamp(nft.search_order_created_at), combined.created_at) AS order_created_at
          FROM combined
          JOIN `
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`.nft nft ON nft.id = combined.nft_id
          WHERE nft.search_is_land = TRUE
            AND (nft.search_estate_size > 0 OR nft.search_estate_size IS NULL)
            `
        )
        .append(filters.category ? SQL` AND nft.category = ${filters.category}` : SQL``)
        .append(
          SQL`
          `
            .append(getNFTsSortBy(filters.sortBy))
            .append(getNFTLimitAndOffsetStatement(filters))
            .append(
              SQL`
      )
      SELECT 
        top_nfts.count,
        top_nfts.id,
        top_nfts.contract_address,
        top_nfts.token_id,
        top_nfts.network,
        top_nfts.created_at,
        top_nfts.url,
        top_nfts.updated_at,
        top_nfts.sold_at,
        top_nfts.urn,
        top_nfts.price,
        top_nfts.owner_id,
        top_nfts.image,
        top_nfts.issued_id,
        top_nfts.category,
        top_nfts.name,
        top_nfts.item_type,
        parcel_data.x,
        parcel_data.y,
        estate_data.estate_parcels,
        estate_data.size,
        parcel_data.parcel_estate_token_id,
        parcel_data.parcel_estate_name,
        parcel_data.estate_id AS parcel_estate_id,
        top_nfts.order_created_at
      FROM top_nfts
      LEFT JOIN LATERAL (
          SELECT p.x,
                p.y,
                p.estate_id,
                par_est.token_id AS parcel_estate_token_id,
                est_data.name AS parcel_estate_name
          FROM `
                .append(MARKETPLACE_SQUID_SCHEMA)
                .append(
                  SQL`.parcel p
          LEFT JOIN `
                )
                .append(MARKETPLACE_SQUID_SCHEMA)
                .append(
                  SQL`.estate par_est ON p.estate_id = par_est.id
          LEFT JOIN `
                    .append(MARKETPLACE_SQUID_SCHEMA)
                    .append(
                      SQL`.data est_data ON par_est.data_id = est_data.id
          WHERE p.id = top_nfts.id
          LIMIT 1
      ) parcel_data ON TRUE
      LEFT JOIN LATERAL (
          SELECT est.size,
                array_agg(json_build_object('x', ep.x, 'y', ep.y)) AS estate_parcels
          FROM `
                        .append(MARKETPLACE_SQUID_SCHEMA)
                        .append(
                          SQL`.estate est
          LEFT JOIN `
                            .append(MARKETPLACE_SQUID_SCHEMA)
                            .append(
                              SQL`.parcel ep ON est.id = ep.estate_id
          WHERE est.size > 0
            AND est.id = top_nfts.id
          GROUP BY est.size
          LIMIT 1
      ) estate_data ON TRUE
       
      `
                            )
                            .append(getNFTsSortBy(filters.sortBy))
                            .append(SQL``)
                        )
                    )
                )
            )
        )
    )
}

// @TODO DEBUG WHY THIS FILTERS ARE SLOWING DOWN THE QUERY AND ENABLE THEM BACK

export function getAllLANDsQuery(filters: GetNFTsFilters) {
  const { sortBy } = filters
  const {
    FILTER_BY_MAX_PLAZA_DISTANCE,
    FILTER_BY_MAX_ORDER_PRICE,
    FILTER_BY_MIN_PLAZA_DISTANCE,
    FILTER_BY_MIN_ORDER_PRICE,
    FILTER_BY_OWNER,
    FILTER_BY_ROAD_ADJACENT,
    FILTER_MAX_ESTATE_SIZE,
    FILTER_MIN_ESTATE_SIZE,
    // FILTER_BY_IDS, //@TODO check this ones out
    FILTER_BY_SEARCH,
    FILTER_CATEGORY
  } = getAllLANDWheres(filters)

  const topNFTsWhere = [
    SQL`search_is_land = TRUE`,
    FILTER_BY_OWNER,
    FILTER_BY_MIN_ORDER_PRICE,
    FILTER_BY_MAX_ORDER_PRICE,
    FILTER_MIN_ESTATE_SIZE,
    FILTER_MAX_ESTATE_SIZE,
    FILTER_BY_MIN_PLAZA_DISTANCE,
    FILTER_BY_MAX_PLAZA_DISTANCE,
    FILTER_BY_ROAD_ADJACENT,
    FILTER_CATEGORY,
    FILTER_BY_SEARCH
  ]

  return getTradesCTE(filters).append(
    SQL`
    , land_count AS (
      SELECT count(*) AS total_count
      FROM `
      .append(MARKETPLACE_SQUID_SCHEMA)
      .append(
        SQL`.nft
      `
      )
      .append(getWhereStatementFromFilters(topNFTsWhere))
      .append(
        SQL`
    ),
    top_land AS (
        SELECT id
        FROM `
          .append(MARKETPLACE_SQUID_SCHEMA)
          .append(
            SQL`.nft
        `
          )
          .append(getWhereStatementFromFilters(topNFTsWhere))
          .append(getNFTsSortBy(sortBy))
          .append(getNFTLimitAndOffsetStatement(filters))
          .append(
            SQL`
    ),
    open_orders_nfts AS (
        SELECT 
            nft.id AS nft_id,
            o.price,
            to_timestamp(o.created_at) AS order_created_at
        FROM top_land
        JOIN `
              .append(MARKETPLACE_SQUID_SCHEMA)
              .append(
                SQL`.nft nft ON nft.id = top_land.id
        JOIN `.append(MARKETPLACE_SQUID_SCHEMA).append(SQL`."order" o ON nft.active_order_id = o.id
        WHERE o.status = 'open'
          AND o.expires_at_normalized > NOW()
    ) `)
              )
              .append(getOpenTradesCTE(filters))
              .append(
                SQL`
      , combined AS (
          SELECT nft_id, price, order_created_at AS created_at FROM open_orders_nfts
          UNION
          SELECT nft_id, price, trade_created_at AS created_at FROM open_trades
      )
      SELECT 
          land_count.total_count AS count,
          nft.id,
          nft.contract_address,
          nft.token_id,
          nft.network,
          nft.created_at,
          nft.token_uri AS url,
          nft.updated_at,
          nft.sold_at,
          nft.urn,
          combined.price,
          nft.owner_id,
          nft.image,
          nft.issued_id,
          nft.category,
          nft.name,
          nft.item_type,
          parcel_data.x,
          parcel_data.y,
          estate_data.estate_parcels,
          estate_data.size,
          parcel_data.parcel_estate_token_id,
          parcel_data.parcel_estate_name,
          parcel_data.estate_id AS parcel_estate_id,
          GREATEST(to_timestamp(nft.search_order_created_at), combined.created_at) AS order_created_at
      FROM top_land
      CROSS JOIN land_count
      JOIN `
                  .append(MARKETPLACE_SQUID_SCHEMA)
                  .append(
                    SQL`.nft nft ON nft.id = top_land.id
      LEFT JOIN combined ON top_land.id = combined.nft_id
      LEFT JOIN LATERAL (
          SELECT p.x,
                p.y,
                p.estate_id,
                par_est.token_id AS parcel_estate_token_id,
                est_data.name AS parcel_estate_name
          FROM `
                      .append(MARKETPLACE_SQUID_SCHEMA)
                      .append(
                        SQL`.parcel p
          LEFT JOIN `
                          .append(MARKETPLACE_SQUID_SCHEMA)
                          .append(
                            SQL`.estate par_est ON p.estate_id = par_est.id
          LEFT JOIN `
                              .append(MARKETPLACE_SQUID_SCHEMA)
                              .append(
                                SQL`.data est_data ON par_est.data_id = est_data.id
          WHERE p.id = top_land.id
          LIMIT 1
      ) parcel_data ON TRUE
      LEFT JOIN LATERAL (
          SELECT est.size,
                array_agg(json_build_object('x', ep.x, 'y', ep.y)) AS estate_parcels
          FROM `
                                  .append(MARKETPLACE_SQUID_SCHEMA)
                                  .append(
                                    SQL`.estate est
          LEFT JOIN `
                                      .append(MARKETPLACE_SQUID_SCHEMA)
                                      .append(
                                        SQL`.parcel ep ON est.id = ep.estate_id
          WHERE est.size > 0
            AND est.id = top_land.id
          GROUP BY est.size
          LIMIT 1
      ) estate_data ON TRUE
      `
                                          .append(getNFTsSortBy(sortBy))
                                          .append(SQL``)
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
