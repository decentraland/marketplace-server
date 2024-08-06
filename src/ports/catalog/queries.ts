import SQL, { SQLStatement } from 'sql-template-strings'
import {
  CatalogFilters,
  CatalogSortBy,
  CatalogSortDirection,
  EmoteCategory,
  EmotePlayMode,
  GenderFilterOption,
  NFTCategory,
  Network,
  WearableCategory
} from '@dcl/schemas'
import { BUILDER_SERVER_TABLE_SCHEMA, MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { CatalogQueryFilters } from './types'
import { FragmentItemType } from './utils'

const getBuilderServerTagsJoin = () => {
  return SQL`LEFT JOIN builder_server_items ON builder_server_items.item_id = items.id::text `
}

const wrapQuery = (statement: SQLStatement, start: SQLStatement, end: SQLStatement) => start.append(statement).append(end)

const getItemIdsByUtilityQuery = (filters: CatalogQueryFilters) => {
  const { search } = filters
  const includesUtilityKeyword = search?.toLowerCase().includes('utility')
  let where = SQL``
  if (!includesUtilityKeyword) {
    where = SQL`WHERE `.append(BUILDER_SERVER_TABLE_SCHEMA).append(SQL`.mv_builder_server_items_utility.utility % ${search}`)
  }

  // Reduce the weight of the utility similarity so it doesn't overshadow the rest of the search
  const similarityColumn = SQL`similarity(`
    .append(BUILDER_SERVER_TABLE_SCHEMA)
    .append(SQL`.mv_builder_server_items_utility.utility, ${search}) * 0.5`)

  const query = SQL`SELECT `
    .append(BUILDER_SERVER_TABLE_SCHEMA)
    .append(".mv_builder_server_items_utility.item_id as id, 'utility' as match_type, '' as word, ")
  // If the utility keyword is included in the search, we want to give it a higher weight to items with utility
  if (includesUtilityKeyword) {
    query.append(wrapQuery(similarityColumn, SQL`GREATEST(`, SQL`, 0.01)`))
  } else {
    query.append(similarityColumn)
  }
  query
    .append(SQL` AS word_similarity FROM `.append(BUILDER_SERVER_TABLE_SCHEMA).append(SQL`.mv_builder_server_items_utility LEFT JOIN `))
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.item AS items ON items.id = `.append(BUILDER_SERVER_TABLE_SCHEMA).append(SQL`.mv_builder_server_items_utility.item_id `))
    .append(where)
    .append(SQL` ORDER BY word_similarity DESC, items.first_listed_at DESC`)

  return query
}

const getItemIdsByTagOrNameQuery = (filters: CatalogQueryFilters) => {
  const { search } = filters
  const query = getSearchCTEs(filters).append(
    SQL`SELECT
        items.id AS id,
        CASE WHEN builder_server_items.item_id IS NULL THEN 'name' ELSE 'tag' END AS match_type,
        word.text AS word,
        similarity(word.text, ${search}) AS word_similarity
      `
      .append(' FROM ')
      .append(MARKETPLACE_SQUID_SCHEMA)
      .append(
        `.item AS items
        `
      )
      .append(getLatestMetadataJoin(filters))
      .append(
        SQL`
          LEFT JOIN (
            SELECT
                metadata.id,
                COALESCE(wearable.name, emote.name) AS name
            FROM
                `
          .append(MARKETPLACE_SQUID_SCHEMA)
          .append(
            SQL`.metadata AS metadata
                LEFT JOIN `
              .append(MARKETPLACE_SQUID_SCHEMA)
              .append(
                SQL`.wearable AS wearable ON metadata.wearable_id = wearable.id AND metadata.item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1')
                LEFT JOIN `.append(MARKETPLACE_SQUID_SCHEMA)
                  .append(SQL`.emote AS emote ON metadata.emote_id = emote.id AND metadata.item_type = 'emote_v1'
        ) AS metadata ON metadata.id = latest_metadata.latest_metadata_id
      `)
              )
          )
      )
      .append(getWhereWordsJoin())
      .append(getBuilderServerTagsJoin())
      .append('WHERE ')
      .append(getSearchWhere(filters))
      .append(' ORDER BY word_similarity DESC')
  )

  return query
}

const getLatestMetadataJoin = (filters: CatalogQueryFilters) => {
  return filters.network === Network.ETHEREUM
    ? SQL`
        LEFT JOIN latest_metadata ON latest_metadata.item_id = items.metadata ` // TODO: This will be fix during next indexation, is a workaround for the current one
    : SQL`
        LEFT JOIN latest_metadata ON latest_metadata.item_id = items.id `
}

const getLatestMetadataCTE = () => {
  return SQL`latest_metadata AS (
        SELECT DISTINCT ON (wearable_id) wearable_id as item_id, id AS latest_metadata_id, item_type, wearable_id, emote_id
        FROM metadata
        ORDER BY wearable_id DESC
      )
    `
}

const getSearchCTEs = (filters: CatalogQueryFilters) => {
  return SQL`WITH `.append(getLatestMetadataCTE()).append(
    SQL`, builder_server_items AS (
      SELECT
      item_id,
      tag
    FROM
      `.append(BUILDER_SERVER_TABLE_SCHEMA).append(SQL`.mv_builder_server_items
    WHERE
      LOWER(tag) = LOWER(${filters.search})
    )
  `)
  )
}

const WEARABLE_ITEM_TYPES = [FragmentItemType.WEARABLE_V1, FragmentItemType.WEARABLE_V2, FragmentItemType.SMART_WEARABLE_V1]

const MAX_ORDER_TIMESTAMP = 253378408747000 // some orders have a timestmap that can't be cast by Postgres, this is the max possible value

export function getOrderBy(filters: CatalogFilters) {
  const { sortBy, sortDirection, isOnSale, search, ids } = filters
  const sortByParam = sortBy ?? CatalogSortBy.NEWEST
  const sortDirectionParam = sortDirection ?? CatalogSortDirection.DESC

  // When seeing "Not for sale", the only sort available is the Newest one
  if (isOnSale === false && sortByParam !== CatalogSortBy.NEWEST) {
    return ''
  }

  if (search && !sortBy && ids?.length) {
    // If the filters have a search term, there's no other Sort applied and ids matching the search were returned, then
    // we need to order by the position of the item in the search results that is pre-computed and passed in the ids filter.
    return SQL`ORDER BY array_position(${filters.ids}::text[], id) `
  }

  let sortByQuery: SQLStatement | string = `ORDER BY first_listed_at ${sortDirectionParam}\n`
  switch (sortByParam) {
    case CatalogSortBy.NEWEST:
      sortByQuery = 'ORDER BY first_listed_at desc NULLS last \n'
      break
    case CatalogSortBy.MOST_EXPENSIVE:
      sortByQuery = 'ORDER BY max_price desc \n'
      break
    case CatalogSortBy.RECENTLY_LISTED:
      sortByQuery = 'ORDER BY GREATEST(max_order_created_at, first_listed_at) desc \n'
      break
    case CatalogSortBy.RECENTLY_SOLD:
      sortByQuery = 'ORDER BY sold_at desc \n'
      break
    case CatalogSortBy.CHEAPEST:
      sortByQuery = 'ORDER BY min_price asc, first_listed_at desc \n'
      break
  }

  return sortByQuery
}

export const addQueryPagination = (query: SQLStatement, filters: CatalogQueryFilters) => {
  const { limit, offset } = filters
  if (limit !== undefined && offset !== undefined) {
    query.append(SQL`LIMIT ${limit} OFFSET ${offset}`)
  }
}

export const addQuerySort = (query: SQLStatement, filters: CatalogQueryFilters) => {
  const { sortBy, sortDirection } = filters
  if (sortBy && sortDirection) {
    query.append(getOrderBy(filters))
  }
}

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
  if (filters.category === NFTCategory.EMOTE || filters.category === NFTCategory.WEARABLE) {
    return SQL`word::text % ${filters.search}`
  }
  return SQL`word_wearable::text % ${filters.search} OR word_emote::text % ${filters.search}`
}

export const getIsSoldOutWhere = () => {
  return SQL`items.available = 0`
}

export const getIsOnSale = (filters: CatalogFilters) => {
  return filters.isOnSale
    ? SQL`((search_is_store_minter = true AND available > 0) OR listings_count IS NOT NULL)`
    : SQL`((search_is_store_minter = false OR available = 0) AND listings_count IS NULL)`
}

export const getisWearableHeadAccessoryWhere = () => {
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

export const getMinPriceWhere = (filters: CatalogFilters) => {
  return SQL`(min_price >= ${filters.minPrice} OR (price >= ${filters.minPrice} AND available > 0 AND search_is_store_minter = true))`
}

export const getMaxPriceWhere = (filters: CatalogFilters) => {
  return SQL`(max_price <= ${filters.maxPrice} OR (price <= ${filters.maxPrice} AND available > 0 AND search_is_store_minter = true))`
}

export const getContractAddressWhere = (filters: CatalogFilters) => {
  return SQL`items.collection_id = ANY(${filters.contractAddresses})`
}

export const getOnlyListingsWhere = () => {
  return SQL`(items.search_is_store_minter = false OR (items.search_is_store_minter = true AND available = 0)) AND listings_count > 0`
}

export const getOnlyMintingWhere = () => {
  return SQL`items.search_is_store_minter = true AND available > 0`
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

export const getUrnsWhere = (filters: CatalogFilters) => {
  return SQL`items.urn = ANY(${filters.urns})`
}

export const getCollectionsQueryWhere = (filters: CatalogFilters) => {
  const conditions = [
    filters.category ? getCategoryWhere(filters) : undefined,
    filters.rarities?.length ? getRaritiesWhere(filters) : undefined,
    filters.creator?.length ? getCreatorWhere(filters) : undefined,
    filters.isSoldOut ? getIsSoldOutWhere() : undefined,
    filters.isOnSale !== undefined ? getIsOnSale(filters) : undefined,
    filters.isWearableHead ? getisWearableHeadAccessoryWhere() : undefined,
    filters.isWearableAccessory ? getWearableAccessoryWhere() : undefined,
    filters.wearableCategory ? getWearableCategoryWhere(filters) : undefined,
    filters.wearableGenders?.length ? getWearableGenderWhere(filters) : undefined,
    filters.emoteCategory ? getEmoteCategoryWhere(filters) : undefined,
    filters.emotePlayMode?.length ? getEmotePlayModeWhere(filters) : undefined,
    filters.contractAddresses?.length ? getContractAddressWhere(filters) : undefined,
    filters.minPrice ? getMinPriceWhere(filters) : undefined,
    filters.maxPrice ? getMaxPriceWhere(filters) : undefined,
    filters.onlyListing ? getOnlyListingsWhere() : undefined,
    filters.onlyMinting ? getOnlyMintingWhere() : undefined,
    filters.ids?.length ? getIdsWhere(filters) : undefined,
    filters.emoteHasSound ? getHasSoundWhere() : undefined,
    filters.emoteHasGeometry ? getHasGeometryWhere() : undefined,
    filters.urns?.length ? getUrnsWhere(filters) : undefined
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

/** At the moment, the UI just needs the Owners count when listing the NOT ON SALE items, so for optimize the query, let's JOIN only in that case since it's an expensive operation */
const getOwnersJoin = () => {
  return SQL` LEFT JOIN (
          SELECT item, COUNT(distinct owner) as owners_count FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append('.nft as nfts GROUP BY nfts.item) AS nfts ON nfts.item = items.id')
}

const getMinPriceCase = (filters: CatalogQueryFilters) => {
  return SQL`CASE
                WHEN items.available > 0 AND items.search_is_store_minter = true 
                `.append(filters.minPrice ? SQL`AND items.price >= ${filters.minPrice}` : SQL``)
    .append(` THEN LEAST(items.price, nfts_with_orders.min_price) 
                ELSE nfts_with_orders.min_price 
              END AS min_price
            `)
}

const getMaxPriceCase = (filters: CatalogQueryFilters) => {
  return SQL`CASE
                WHEN items.available > 0 AND items.search_is_store_minter = true 
                `.append(filters.maxPrice ? SQL`AND items.price <= ${filters.maxPrice}` : SQL``)
    .append(` THEN GREATEST(items.price, nfts_with_orders.max_price)
          ELSE nfts_with_orders.max_price 
          END AS max_price
          `)
}

const getWhereWordsJoin = () => {
  return SQL`
      JOIN LATERAL
      (
        SELECT unnest(string_to_array(metadata.name, ' ')) AS text
      UNION
        SELECT tag AS text FROM builder_server_items WHERE builder_server_items.item_id = items.id::text
      ) AS word ON TRUE
  `
}

const getMetadataJoins = () => {
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
    emote.has_geometry
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
              items.creator,
              items.beneficiary,
              items.created_at,
              items.updated_at,
              items.reviewed_at,
              items.sold_at,
              items.network,
              items.first_listed_at,
              items.urn,
              nfts_with_orders.min_price AS min_listing_price,
              nfts_with_orders.max_price AS max_listing_price, 
              COALESCE(nfts_with_orders.listings_count,0) as listings_count,`
    .append(filters.isOnSale === false ? SQL`nfts.owners_count,` : SQL``)
    .append(
      `
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

export const getItemIdsBySearchTextQuery = (filters: CatalogQueryFilters) => {
  const utilityQuery = getItemIdsByUtilityQuery(filters)
  const tagOrNameQuery = getItemIdsByTagOrNameQuery(filters)

  const query = SQL`
      SELECT DISTINCT ON (id) id,
        word_similarity,
        match_type,
        word
        FROM ((`
    .append(utilityQuery)
    .append(SQL`) UNION (`)
    .append(tagOrNameQuery).append(SQL`)) AS items_found
        ORDER BY id DESC, word_similarity DESC`)

  return query
}

export const getCatalogQuery = (filters: CatalogFilters) => {
  return getCollectionsItemsCatalogQuery(filters)
}
