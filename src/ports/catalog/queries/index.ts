import SQL from 'sql-template-strings'
import { CatalogSortBy } from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../../constants'
import { CatalogQueryFilters } from '../types'
import { getCollectionsQueryWhere, getItemLevelFiltersWhere, getOrderRangePriceWhere } from './filters'
import {
  MAX_ORDER_TIMESTAMP,
  addQueryPagination,
  addQuerySort,
  getMaxPriceCase,
  getMaxPriceCaseWithTrades,
  getMetadataJoins,
  getMinItemCreatedAtCTE,
  getMinPriceCase,
  getMinPriceCaseWithTrades,
  getNFTsWithOrdersCTE,
  getOwnersJoin,
  getTopNItemsCTE,
  getTradesCTE,
  getTradesJoin
} from './fragments'
import { getItemIdsByTagOrNameQuery, getItemIdsByUtilityQuery } from './search'

const MAX_NUMERIC_NUMBER = '115792089237316195423570985008687907853269984665640564039457584007913129639935'

export const getCollectionsItemsCountQuery = (filters: CatalogQueryFilters) => {
  // Optimized count query: no metadata joins, no owners, use NOT EXISTS for performance
  // Add metadata joins only when needed for category/playMode filters
  const needsMetadataJoins = filters.wearableCategory || filters.emoteCategory || filters.emotePlayMode?.length

  const query = SQL`
    SELECT COUNT(*) as count
    FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.item AS items `)

  // Add metadata joins conditionally
  if (needsMetadataJoins) {
    query.append(getMetadataJoins())
  }

  // Import getItemLevelFiltersWhere from filters
  query.append(getItemLevelFiltersWhere(filters))

  // Handle isOnSale filter with NOT EXISTS (more efficient than LEFT JOIN + IS NULL)
  if (filters.isOnSale === false) {
    // Not on sale: no minting AND no listings (neither onchain nor offchain)
    query.append(SQL` AND (items.search_is_store_minter = false OR items.available = 0)`)

    // No onchain orders
    query
      .append(
        SQL` AND NOT EXISTS (
      SELECT 1
      FROM `
      )
      .append(MARKETPLACE_SQUID_SCHEMA).append(SQL`.order AS o
      WHERE o.status = 'open'
        AND o.expires_at_normalized > NOW()
        AND o.item_id = items.id
    )`)

    // No offchain trades
    query.append(SQL` AND NOT EXISTS (
      SELECT 1
      FROM marketplace.mv_trades AS t
      WHERE t.status = 'open'
        AND (t.available IS NULL OR t.available > 0)
        AND t.contract_address_sent = items.collection_id
        AND (t.assets->'sent'->>'item_id')::numeric = items.blockchain_id
    )`)
  } else if (filters.isOnSale === true) {
    // On sale: minting OR has listings
    query
      .append(
        SQL` AND (
      (items.search_is_store_minter = true AND items.available > 0)
      OR EXISTS (
        SELECT 1
        FROM `
      )
      .append(MARKETPLACE_SQUID_SCHEMA).append(SQL`.order AS o
        WHERE o.status = 'open'
          AND o.expires_at_normalized > NOW()
          AND o.item_id = items.id
      )
      OR EXISTS (
        SELECT 1
        FROM marketplace.mv_trades AS t
        WHERE t.status = 'open'
          AND (t.available IS NULL OR t.available > 0)
          AND t.contract_address_sent = items.collection_id
          AND (t.assets->'sent'->>'item_id')::numeric = items.blockchain_id
      )
    )`)
  }

  // Handle onlyMinting filter
  if (filters.onlyMinting) {
    query.append(SQL` AND (
      (items.search_is_store_minter = true AND items.available > 0)
      OR EXISTS (
        SELECT 1
        FROM marketplace.mv_trades AS t
        WHERE t.status = 'open'
          AND t.type = 'public_item_order'
          AND (t.available IS NULL OR t.available > 0)
          AND t.contract_address_sent = items.collection_id
          AND (t.assets->'sent'->>'item_id')::numeric = items.blockchain_id`)
    if (filters.minPrice) {
      query.append(SQL`
          AND t.amount_received >= ${filters.minPrice}`)
    }
    if (filters.maxPrice) {
      query.append(SQL`
          AND t.amount_received <= ${filters.maxPrice}`)
    }
    query.append(SQL`
      )
    )`)
  }

  // Handle onlyListing filter
  if (filters.onlyListing) {
    // Match the logic from getOnlyListingsWhereWithTrades:
    // - Items that are NOT minting (neither store minter nor marketplace_v3 minter)
    // - OR store minter items that are sold out
    // - OR marketplace_v3 minter items that have no active item trades (public_item_order)
    query.append(SQL` AND (
      (items.search_is_store_minter = false AND items.search_is_marketplace_v3_minter = false)
      OR (items.search_is_store_minter = true AND items.available = 0)
      OR (items.search_is_marketplace_v3_minter = true AND NOT EXISTS (
        SELECT 1
        FROM marketplace.mv_trades AS t
        WHERE t.status = 'open'
          AND t.type = 'public_item_order'
          AND (t.available IS NULL OR t.available > 0)
          AND t.contract_address_sent = items.collection_id
          AND (t.assets->'sent'->>'item_id')::numeric = items.blockchain_id
      ))
    )`)
    query
      .append(
        SQL` AND (
      EXISTS (
        SELECT 1
        FROM `
      )
      .append(MARKETPLACE_SQUID_SCHEMA).append(SQL`.order AS o
        WHERE o.status = 'open'
          AND o.expires_at_normalized > NOW()
          AND o.item_id = items.id
      )
      OR EXISTS (
        SELECT 1
        FROM marketplace.mv_trades AS t
        WHERE t.status = 'open'
          AND t.type = 'public_nft_order'
          AND (t.available IS NULL OR t.available > 0)
          AND t.contract_address_sent = items.collection_id
          AND (t.assets->'sent'->>'item_id')::numeric = items.blockchain_id
      )
    )`)
  }

  // Handle minPrice filter
  if (filters.minPrice) {
    if (filters.onlyMinting) {
      query.append(SQL` AND items.price >= ${filters.minPrice} AND items.price IS DISTINCT FROM ${MAX_NUMERIC_NUMBER}`)
    } else if (filters.onlyListing) {
      query
        .append(
          SQL` AND (
        EXISTS (
          SELECT 1
          FROM `
        )
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`.order AS o
          WHERE o.status = 'open'
            AND o.expires_at_normalized > NOW()
            AND o.item_id = items.id
            AND o.price >= ${filters.minPrice}
        )
        OR EXISTS (
          SELECT 1
          FROM marketplace.mv_trades AS t
          WHERE t.status = 'open'
            AND t.type = 'public_nft_order'
            AND (t.available IS NULL OR t.available > 0)
            AND t.contract_address_sent = items.collection_id
            AND (t.assets->'sent'->>'item_id')::numeric = items.blockchain_id
            AND t.amount_received >= ${filters.minPrice}
        )
      )`
        )
    } else {
      query
        .append(
          SQL` AND (
        (items.price >= ${filters.minPrice} AND items.available > 0 AND (items.search_is_store_minter = true OR items.search_is_marketplace_v3_minter = true))
        OR EXISTS (
          SELECT 1
          FROM `
        )
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`.order AS o
          WHERE o.status = 'open'
            AND o.expires_at_normalized > NOW()
            AND o.item_id = items.id
            AND o.price >= ${filters.minPrice}
        )
        OR EXISTS (
          SELECT 1
          FROM marketplace.mv_trades AS t
          WHERE t.status = 'open'
            AND (t.available IS NULL OR t.available > 0)
            AND t.contract_address_sent = items.collection_id
            AND (t.assets->'sent'->>'item_id')::numeric = items.blockchain_id
            AND t.amount_received >= ${filters.minPrice}
        )
      )`
        )
    }
  }

  // Handle maxPrice filter
  if (filters.maxPrice) {
    if (filters.onlyMinting) {
      query.append(SQL` AND items.price <= ${filters.maxPrice}`)
    } else if (filters.onlyListing) {
      query
        .append(
          SQL` AND (
        EXISTS (
          SELECT 1
          FROM `
        )
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`.order AS o
          WHERE o.status = 'open'
            AND o.expires_at_normalized > NOW()
            AND o.item_id = items.id
            AND o.price <= ${filters.maxPrice}
        )
        OR EXISTS (
          SELECT 1
          FROM marketplace.mv_trades AS t
          WHERE t.status = 'open'
            AND t.type = 'public_nft_order'
            AND (t.available IS NULL OR t.available > 0)
            AND t.contract_address_sent = items.collection_id
            AND (t.assets->'sent'->>'item_id')::numeric = items.blockchain_id
            AND t.amount_received <= ${filters.maxPrice}
        )
      )`
        )
    } else {
      query
        .append(
          SQL` AND (
        (items.price <= ${filters.maxPrice} AND items.available > 0 AND (items.search_is_store_minter = true OR items.search_is_marketplace_v3_minter = true))
        OR EXISTS (
          SELECT 1
          FROM `
        )
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`.order AS o
          WHERE o.status = 'open'
            AND o.expires_at_normalized > NOW()
            AND o.item_id = items.id
            AND o.price <= ${filters.maxPrice}
        )
        OR EXISTS (
          SELECT 1
          FROM marketplace.mv_trades AS t
          WHERE t.status = 'open'
            AND (t.available IS NULL OR t.available > 0)
            AND t.contract_address_sent = items.collection_id
            AND (t.assets->'sent'->>'item_id')::numeric = items.blockchain_id
            AND t.amount_received <= ${filters.maxPrice}
        )
      )`
        )
    }
  }

  return query
}

export const getCollectionsItemsCatalogQueryWithTrades = (filters: CatalogQueryFilters) => {
  const query = SQL``
    .append(getTradesCTE())
    .append(getTopNItemsCTE(filters))
    .append(filters.onlyMinting ? SQL`` : getNFTsWithOrdersCTE(filters))
    .append(getMinItemCreatedAtCTE())
    .append(
      SQL`
            SELECT
              items.id,
              items.blockchain_id,
              items.search_is_collection_approved,
              to_json(
                CASE WHEN (
                  items.item_type = 'wearable_v1' OR items.item_type = 'wearable_v2' OR items.item_type = 'smart_wearable_v1') THEN metadata_wearable
                  ELSE metadata_emote
                END
              ) as metadata,
              items.image,
              items.blockchain_id,
              items.collection_id,
              items.rarity,
              items.item_type::text,
              items.price,
              items.available,
              items.search_is_store_minter,
              items.search_is_marketplace_v3_minter,
              items.creator,
              items.beneficiary,
              items.created_at,
              items.updated_at,
              items.reviewed_at,
              items.sold_at,
              items.network,
              offchain_orders.open_item_trade_id,
              offchain_orders.open_item_trade_price,
              `
        .append(
          filters.isOnSale // When filtering for NOT on sale, calculating this from the offchain orders is very expensive, we just avoid it
            ? SQL`LEAST(items.first_listed_at, ROUND(EXTRACT(EPOCH FROM ut_min_item.min_item_created_at))) as first_listed_at,`
            : SQL`items.first_listed_at as first_listed_at,`
        )
        .append(
          filters.onlyMinting
            ? SQL`
              items.urn,
                CASE
                  WHEN offchain_orders.min_order_amount_received IS NULL THEN NULL
                  ELSE LEAST(
                    COALESCE(offchain_orders.min_order_amount_received, ${MAX_NUMERIC_NUMBER})
                  )
                END AS min_listing_price,
                0 AS min_onchain_price,
                offchain_orders.max_order_amount_received AS max_listing_price,
                NULL AS max_onchain_price,
                COALESCE(offchain_orders.nfts_listings_count, 0) AS listings_count,
                COALESCE(offchain_orders.count, 0) AS offchain_listings_count,
                0 as onchain_listings_count,
                EXTRACT(EPOCH FROM offchain_orders.max_created_at) AS max_order_created_at,
            `
            : SQL`
              items.urn,
              CASE
                WHEN offchain_orders.min_order_amount_received IS NULL AND nfts_with_orders.min_price IS NULL THEN NULL
                ELSE LEAST(
                  COALESCE(offchain_orders.min_order_amount_received, nfts_with_orders.min_price),
                  COALESCE(nfts_with_orders.min_price, offchain_orders.min_order_amount_received)
                )
              END AS min_listing_price,
              nfts_with_orders.min_price AS min_onchain_price,
              GREATEST(offchain_orders.max_order_amount_received, nfts_with_orders.max_price) AS max_listing_price,
              nfts_with_orders.max_price AS max_onchain_price,
              COALESCE(nfts_with_orders.orders_listings_count, 0) + COALESCE(offchain_orders.nfts_listings_count, 0) AS listings_count,
              COALESCE(offchain_orders.count, 0) AS offchain_listings_count,
              COALESCE(nfts_with_orders.orders_listings_count,0) as onchain_listings_count,
              GREATEST(
                ROUND(EXTRACT(EPOCH FROM offchain_orders.max_created_at)),
                nfts_with_orders.max_order_created_at
              ) AS max_order_created_at,`
        )
        .append(filters.isOnSale === false ? SQL`nfts.owners_count,` : SQL``)
        .append(getMinPriceCaseWithTrades(filters))
        .append(
          `,
              `
        )
        .append(getMaxPriceCaseWithTrades(filters))
        .append(
          filters.isOnSale === false && (filters.sortBy === CatalogSortBy.NEWEST || filters.sortBy === CatalogSortBy.RECENTLY_SOLD)
            ? SQL`FROM top_n_items as items`
            : SQL`
            FROM `
                .append(MARKETPLACE_SQUID_SCHEMA)
                .append(SQL`.item AS items`)
        )
        .append(filters.isOnSale === false ? getOwnersJoin() : SQL``)
        .append(
          filters.onlyMinting
            ? SQL``
            : SQL`
            LEFT JOIN nfts_with_orders ON nfts_with_orders.item_id = items.id
              `
        )
        .append(getMetadataJoins())
        .append(getTradesJoin(filters))
        .append(getCollectionsQueryWhere(filters, true))
    )

  addQuerySort(query, filters, true)
  addQueryPagination(query, filters)
  return query
}

export const getItemIdsBySearchTextQuery = (filters: CatalogQueryFilters) => {
  const utilityQuery = getItemIdsByUtilityQuery(filters)
  const tagOrNameQuery = getItemIdsByTagOrNameQuery(filters)

  const query = SQL`
      SELECT id,
        word_similarity,
        match_type,
        word
        FROM ((`
    .append(utilityQuery)
    .append(SQL`) UNION (`)
    .append(tagOrNameQuery).append(SQL`)) AS items_found
        ORDER BY word_similarity DESC`)

  return query
}

export const getCollectionsItemsCatalogQuery = (filters: CatalogQueryFilters) => {
  const query = SQL`
            SELECT
              COUNT(*) OVER() as total_rows,
              items.id,
              items.blockchain_id,
              items.search_is_collection_approved,
              to_json(
                CASE WHEN (
                  items.item_type = 'wearable_v1' OR items.item_type = 'wearable_v2' OR items.item_type = 'smart_wearable_v1') THEN metadata_wearable
                  ELSE metadata_emote
                END
              ) as metadata,
              items.image,
              items.blockchain_id,
              items.collection_id,
              items.rarity,
              items.item_type::text,
              items.price,
              items.available,
              items.search_is_store_minter,
              items.search_is_marketplace_v3_minter,
              items.creator,
              items.beneficiary,
              items.created_at,
              items.updated_at,
              items.reviewed_at,
              items.sold_at,
              items.network,
              items.first_listed_at,
              items.urn,
              `
    .append(
      filters.onlyMinting
        ? SQL`NULL AS min_listing_price, NULL AS max_listing_price, 0 as listings_count,`
        : SQL`nfts_with_orders.min_price AS min_listing_price, nfts_with_orders.max_price AS max_listing_price, COALESCE(nfts_with_orders.listings_count,0) as listings_count,`
    )
    .append(filters.isOnSale === false ? SQL`nfts.owners_count,` : SQL``)
    .append(
      filters.onlyMinting
        ? SQL``
        : `
              nfts_with_orders.max_order_created_at as max_order_created_at,
              `
    )
    .append(getMinPriceCase(filters))
    .append(
      `,
              `
    )
    .append(getMaxPriceCase(filters))
    .append(
      SQL`
            FROM `
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(SQL`.item AS items`)
    )
    .append(filters.isOnSale === false ? getOwnersJoin() : SQL``)
    .append(
      SQL`
            LEFT JOIN (
              SELECT
                orders.item_id,
                COUNT(orders.id) AS listings_count,
                MIN(orders.price) AS min_price,
                MAX(orders.price) AS max_price,
                MAX(orders.created_at) AS max_order_created_at
              FROM `
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`.order AS orders
            WHERE
                orders.status = 'open'
                AND orders.expires_at < `
        )
        .append(MAX_ORDER_TIMESTAMP)
    )
    .append(
      `
                AND ((LENGTH(orders.expires_at::text) = 13 AND TO_TIMESTAMP(orders.expires_at / 1000.0) > NOW())
                      OR
                    (LENGTH(orders.expires_at::text) = 10 AND TO_TIMESTAMP(orders.expires_at) > NOW()))
                `
    )
    .append(getOrderRangePriceWhere(filters))
    .append(
      `
                GROUP BY orders.item_id
              ) AS nfts_with_orders ON nfts_with_orders.item_id = items.id
              `
    )
    .append(getMetadataJoins())
    .append(getCollectionsQueryWhere(filters))

  addQuerySort(query, filters)
  addQueryPagination(query, filters)
  return query
}

// Re-export for external consumers
export * from './filters'
export * from './fragments'
export { getItemIdsByUtilityQuery, getItemIdsByTagOrNameQuery } from './search'
