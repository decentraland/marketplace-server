import SQL, { SQLStatement } from 'sql-template-strings'
import {
  CatalogFilters,
  CatalogSortBy,
  CatalogSortDirection,
  EmoteCategory,
  NFTCategory,
  NFTSortBy
} from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../../constants'
import { CatalogQueryFilters } from '../types'
import { getOrderRangePriceWhere } from './filters'
import { getItemLevelFiltersWhere } from './filters'

export const MAX_ORDER_TIMESTAMP = 253378408747000 // some orders have a timestmap that can't be cast by Postgres, this is the max possible value

const MAX_NUMERIC_NUMBER = '115792089237316195423570985008687907853269984665640564039457584007913129639935'

export function getOrderBy(filters: CatalogFilters, isV2 = false) {
  const { sortBy, sortDirection, isOnSale, search, ids } = filters
  const sortByParam = sortBy ?? CatalogSortBy.NEWEST
  const sortDirectionParam = sortDirection ?? CatalogSortDirection.DESC

  // When seeing "Not for sale", the only sort available is the Newest one
  if (isOnSale === false && sortByParam !== CatalogSortBy.NEWEST) {
    return ''
  }

  const sortByQuery: SQLStatement = SQL`ORDER BY `
  if (search && ids?.length) {
    // If the filters have a search term, we need to order by the position of the item in the search results that is pre-computed and passed in the ids filter.
    sortByQuery.append(SQL`array_position(${filters.ids}::text[], id), `)
  }
  switch (sortByParam) {
    case CatalogSortBy.NEWEST:
      sortByQuery.append(SQL`
        GREATEST(
          COALESCE(ROUND(EXTRACT(EPOCH FROM offchain_orders.item_first_listed_at)), 0),
          first_listed_at
        ) desc nulls LAST \n`)
      break
    case CatalogSortBy.MOST_EXPENSIVE:
      sortByQuery.append(SQL`max_price desc \n`)
      break
    case CatalogSortBy.RECENTLY_LISTED:
      isV2
        ? sortByQuery.append(
            filters.onlyMinting
              ? SQL`
              GREATEST(GREATEST(
                COALESCE(ROUND(EXTRACT(EPOCH FROM offchain_orders.max_created_at)), 0)
              ), first_listed_at) desc \n`
              : SQL`
              GREATEST(GREATEST(
                COALESCE(ROUND(EXTRACT(EPOCH FROM offchain_orders.max_created_at)), 0),
                COALESCE(nfts_with_orders.max_order_created_at, 0)
              ), first_listed_at) desc \n`
          )
        : sortByQuery.append(SQL`GREATEST(max_order_created_at, first_listed_at) desc \n`)
      break
    case CatalogSortBy.RECENTLY_SOLD:
      sortByQuery.append(SQL`sold_at desc \n`)
      break
    case CatalogSortBy.CHEAPEST:
      sortByQuery.append(SQL`min_price asc, first_listed_at desc \n`)
      break
    default:
      sortByQuery.append(SQL`first_listed_at ${sortDirectionParam}\n`)
  }

  return sortByQuery
}

export const addQueryPagination = (query: SQLStatement, filters: CatalogQueryFilters) => {
  const { limit, offset } = filters
  if (limit !== undefined && offset !== undefined) {
    query.append(SQL`LIMIT ${limit} OFFSET ${offset}`)
  }
}

export const addQuerySort = (query: SQLStatement, filters: CatalogQueryFilters, isV2 = false) => {
  const { sortBy, sortDirection } = filters
  if (sortBy && sortDirection) {
    query.append(getOrderBy(filters, isV2))
  }
}

/** At the moment, the UI just needs the Owners count when listing the NOT ON SALE items, so to optimize the query, let's JOIN only in that case since it's an expensive operation */
export const getOwnersJoin = () => {
  return SQL` LEFT JOIN LATERAL (
         SELECT count(DISTINCT owner_id) AS owners_count FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append('.nft WHERE nft.item_id = items.id) AS nfts ON true ')
}

export const getMetadataJoins = () => {
  return SQL` LEFT JOIN (
    SELECT
    metadata.id as metadata_id,
    wearable.description,
    wearable.category,
    wearable.body_shapes,
    wearable.rarity,
    wearable.name
  FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.wearable AS wearable
  JOIN `
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`.metadata AS metadata ON metadata.wearable_id = wearable.id
) AS metadata_wearable ON metadata_wearable.metadata_id = items.metadata_id AND (items.item_type = 'wearable_v1' OR items.item_type = 'wearable_v2' OR items.item_type = 'smart_wearable_v1')
LEFT JOIN (
  SELECT
    metadata.id as metadata_id,
    emote.description,
    emote.category,
    emote.body_shapes,
    emote.rarity,
    emote.name,
    emote.loop,
    emote.has_sound,
    emote.has_geometry,
    emote.outcome_type
  FROM `
            .append(MARKETPLACE_SQUID_SCHEMA)
            .append(
              SQL`.emote AS emote
    JOIN `.append(MARKETPLACE_SQUID_SCHEMA).append(SQL`.metadata AS metadata ON metadata.emote_id = emote.id
) AS metadata_emote ON metadata_emote.metadata_id = items.metadata_id AND items.item_type = 'emote_v1' `)
            )
        )
    )
}

export const getWhereWordsJoin = () => {
  return SQL`
      JOIN LATERAL
      (
        SELECT unnest(string_to_array(metadata.name, ' ')) AS text
      UNION
        SELECT tag AS text FROM builder_server_items WHERE builder_server_items.item_id = items.id::text
      ) AS word ON TRUE
  `
}

export const getMinPriceCase = (filters: CatalogQueryFilters) => {
  return SQL`CASE
                WHEN items.available > 0 AND (items.search_is_store_minter = true OR items.search_is_marketplace_v3_minter = true)
                `.append(filters.minPrice ? SQL`AND items.price >= ${filters.minPrice}` : SQL``)
    .append(` THEN LEAST(items.price, nfts_with_orders.min_price)
                ELSE nfts_with_orders.min_price
              END AS min_price
            `)
}

export const getMinPriceCaseWithTrades = (filters: CatalogQueryFilters) => {
  /*
    This has a workaround to remove the NULLs from the LEAST function, because it will pick NULL as the lowest value.
    To avoid this, we add the COALESCE with a very high number, so it will always pick the other value.
  */
  return SQL`CASE
                WHEN items.available > 0 AND (items.search_is_store_minter = true OR items.search_is_marketplace_v3_minter = true)
                `
    .append(filters.minPrice ? SQL`AND items.price >= ${filters.minPrice}` : SQL``)
    .append(
      filters.onlyMinting
        ? SQL`
                THEN LEAST(
                    COALESCE(items.price, ${MAX_NUMERIC_NUMBER}),
                    COALESCE(offchain_orders.min_order_amount_received, ${MAX_NUMERIC_NUMBER}),
                    COALESCE(offchain_orders.open_item_trade_price, ${MAX_NUMERIC_NUMBER})
                  )
                ELSE LEAST(
                  COALESCE(offchain_orders.min_order_amount_received, ${MAX_NUMERIC_NUMBER}),
                  COALESCE(offchain_orders.open_item_trade_price, ${MAX_NUMERIC_NUMBER})
                )
              END AS min_price
              `
        : SQL`
                  THEN LEAST(
                    COALESCE(items.price, ${MAX_NUMERIC_NUMBER}),
                    COALESCE(nfts_with_orders.min_price, ${MAX_NUMERIC_NUMBER}),
                    COALESCE(offchain_orders.min_order_amount_received, ${MAX_NUMERIC_NUMBER}),
                    COALESCE(offchain_orders.open_item_trade_price, ${MAX_NUMERIC_NUMBER})
                  )
                ELSE LEAST(
                  COALESCE(nfts_with_orders.min_price, ${MAX_NUMERIC_NUMBER}),
                  COALESCE(offchain_orders.min_order_amount_received, ${MAX_NUMERIC_NUMBER}),
                  COALESCE(offchain_orders.open_item_trade_price, ${MAX_NUMERIC_NUMBER})
                )
              END AS min_price
            `
    )
}

export const getMaxPriceCase = (filters: CatalogQueryFilters) => {
  return filters.onlyMinting
    ? SQL`CASE
            WHEN items.available > 0 AND items.search_is_store_minter = true `.append(
        filters.maxPrice ? SQL`AND items.price <= ${filters.maxPrice}` : SQL``
      ).append(` THEN items.price
          ELSE NULL
          END AS max_price
          `)
    : SQL`CASE
                WHEN items.available > 0 AND items.search_is_store_minter = true
                `.append(filters.maxPrice ? SQL`AND items.price <= ${filters.maxPrice}` : SQL``)
        .append(` THEN GREATEST(items.price, nfts_with_orders.max_price)
          ELSE nfts_with_orders.max_price
          END AS max_price
          `)
}

export const getMaxPriceCaseWithTrades = (filters: CatalogQueryFilters) => {
  return filters.onlyMinting
    ? SQL`CASE
                WHEN items.available > 0 AND (items.search_is_store_minter = true OR items.search_is_marketplace_v3_minter = true)
                `.append(filters.maxPrice ? SQL`AND items.price <= ${filters.maxPrice}` : SQL``)
        .append(` THEN GREATEST(items.price, offchain_orders.max_order_amount_received, offchain_orders.open_item_trade_price)
              ELSE GREATEST(offchain_orders.max_order_amount_received, offchain_orders.open_item_trade_price)
          END AS max_price
          `)
    : SQL`CASE
                WHEN items.available > 0 AND (items.search_is_store_minter = true OR items.search_is_marketplace_v3_minter = true)
                `.append(filters.maxPrice ? SQL`AND items.price <= ${filters.maxPrice}` : SQL``)
        .append(` THEN GREATEST(items.price, nfts_with_orders.max_price, offchain_orders.max_order_amount_received, offchain_orders.open_item_trade_price)
              ELSE GREATEST(nfts_with_orders.max_price, offchain_orders.max_order_amount_received, offchain_orders.open_item_trade_price)
          END AS max_price
          `)
}

export const getTradesCTE = ({
  cteName,
  category,
  sortBy,
  first,
  skip
}: {
  cteName?: string
  category?: NFTCategory | EmoteCategory
  sortBy?: CatalogSortBy | NFTSortBy
  first?: number
  skip?: number
} = {}) => {
  return SQL`
      WITH `
    .append(cteName ?? 'unified_trades')
    .append(
      SQL` AS (
        SELECT * from marketplace.mv_trades
        `
        .append(category ? SQL`WHERE sent_nft_category = ${category} ` : SQL``)
        .append(sortBy === NFTSortBy.RECENTLY_LISTED ? SQL` ORDER BY created_at DESC LIMIT ${first} OFFSET ${skip}` : SQL``)
    )
    .append(SQL`)`)
}

export const getTradesJoin = (filters: CatalogQueryFilters) => {
  return SQL`
        LEFT JOIN
          (
            SELECT
              COUNT(id),
              COUNT(id) FILTER (WHERE status = 'open' and type = 'public_nft_order') AS nfts_listings_count,
              COUNT(id) FILTER (WHERE status = 'open' and type = 'public_item_order') AS items_listings_count,
              contract_address_sent,
              -- Add both MIN and MAX for order_amount_received
              MIN(amount_received) FILTER (WHERE status = 'open' and type = 'public_nft_order') AS min_order_amount_received,
              MAX(amount_received) FILTER (WHERE status = 'open' and type = 'public_nft_order') AS max_order_amount_received,
              -- Item amount is the minimum value for public_item_order
              MAX(assets -> 'sent' ->> 'token_id') AS token_id, -- Max token_id for public_nft_order
              assets -> 'sent' ->> 'item_id' AS item_id, -- Max item_id for public_item_order
              MAX(created_at) AS max_created_at,
              MAX(id::text) FILTER (WHERE status = 'open' and type = 'public_item_order') AS open_item_trade_id,
              MAX(amount_received) FILTER (WHERE status = 'open' and type = 'public_item_order') AS open_item_trade_price,
              MIN(created_at) FILTER (WHERE type = 'public_item_order') AS item_first_listed_at,
              json_agg(assets) AS aggregated_assets -- Aggregate the assets into a JSON array
          FROM unified_trades
            WHERE status = 'open' and (available IS NULL OR available > 0)`
    .append(filters.onlyMinting ? SQL` AND type = 'public_item_order'` : SQL``)
    .append(filters.minPrice ? SQL` AND amount_received >= ${filters.minPrice}` : SQL``)
    .append(filters.maxPrice ? SQL` AND amount_received <= ${filters.maxPrice}` : SQL``).append(SQL`
            GROUP BY contract_address_sent, assets -> 'sent' ->> 'item_id'
          ) AS offchain_orders ON offchain_orders.contract_address_sent = items.collection_id AND offchain_orders.item_id::numeric = items.blockchain_id
            LEFT JOIN ut_min_item
  ON offchain_orders.contract_address_sent = ut_min_item.contract_address_sent
     AND offchain_orders.item_id = ut_min_item.item_id
  `)
}

export const getNFTsWithOrdersCTE = (filters: CatalogQueryFilters) => {
  return (
    SQL`
    , nfts_with_orders AS (SELECT
      orders.item_id,
      COUNT(orders.id) AS orders_listings_count,
      MIN(orders.price) AS min_price,
      MAX(orders.price) AS max_price,
      MAX(orders.created_at) AS max_order_created_at
    FROM `
      .append(MARKETPLACE_SQUID_SCHEMA)
      .append(
        SQL`.order AS orders
        WHERE
            orders.status = 'open'
            AND orders.expires_at_normalized > NOW()`
      )
      // When filtering by NEWEST, we need to join the top_n_items CTE because we just want the N newest ones
      .append(
        filters.isOnSale === false && (filters.sortBy === CatalogSortBy.NEWEST || filters.sortBy === CatalogSortBy.RECENTLY_SOLD)
          ? SQL` AND orders.item_id IN (
                SELECT id::text
                FROM top_n_items
          )`
          : SQL``
      )
      .append(getOrderRangePriceWhere(filters))
      .append(
        `
    GROUP BY orders.item_id
    )
  `
      )
  )
}

export const getTopNItemsCTE = (filters: CatalogQueryFilters) => {
  if (filters.isOnSale === false && (filters.sortBy === CatalogSortBy.NEWEST || filters.sortBy === CatalogSortBy.RECENTLY_SOLD)) {
    const limit = filters.first ?? 10
    const offset = filters.skip ?? 0

    return SQL`
      , top_n_items AS (
        SELECT * FROM `
      .append(MARKETPLACE_SQUID_SCHEMA)
      .append(SQL`.item AS items `)
      .append(getItemLevelFiltersWhere(filters))
      .append(
        SQL`
        ORDER BY items.`.append(filters.sortBy === CatalogSortBy.NEWEST ? 'first_listed_at' : 'sold_at').append(SQL` DESC
        LIMIT ${limit}
        OFFSET ${offset}
      )
    `)
      )
  }
  return SQL``
}

export const getMinItemCreatedAtCTE = () => {
  return SQL`
    , ut_min_item AS (
      SELECT
        contract_address_sent,
        (assets -> 'sent' ->> 'item_id') AS item_id,
        MIN(created_at) AS min_item_created_at
      FROM unified_trades
      WHERE type = 'public_item_order'
      GROUP BY contract_address_sent, (assets -> 'sent' ->> 'item_id')
    )
  `
}
