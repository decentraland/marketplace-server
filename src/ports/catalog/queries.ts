import { IPgComponent } from '@well-known-components/pg-component'
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
import { CatalogQueryFilters } from './types'
import { FragmentItemType } from './utils'

const SCHEMA_PREFIX = 'dcl'

const WEARABLE_ITEM_TYPES = [FragmentItemType.WEARABLE_V1, FragmentItemType.WEARABLE_V2, FragmentItemType.SMART_WEARABLE_V1]

export function getLatestChainSchema(chainId: string) {
  return SQL`
    SELECT 
        entity_schema 
    FROM 
        substreams.network_schema
    WHERE 
        LOWER(network) = LOWER(${chainId})
    `
}

export async function getLatestSchema(database: IPgComponent) {
  let schema: string | undefined
  try {
    const query = SQL`
        SELECT information.schema_name
        FROM information_schema.schemata as information
        WHERE schema_name LIKE ${SCHEMA_PREFIX} || '%'
        ORDER BY CAST(SUBSTRING(information.schema_name FROM 'dcl([0-9]+)') AS INTEGER) desc 
        LIMIT 1
      `
    const getLatestSchemaResult = await database.query<{ schema_name: string }>(query)
    schema = getLatestSchemaResult.rows[0]?.schema_name
  } catch (error) {
    console.error('error:', error)
  }
  return schema
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

const getBuilderServerTagsJoin = () => {
  return SQL`LEFT JOIN builder_server_items ON builder_server_items.item_id = items.id::text `
}

const wrapQuery = (statement: SQLStatement, start: SQLStatement, end: SQLStatement) => start.append(statement).append(end)

const getItemIdsByUtilityQuery = (schemaVersion: string, filters: CatalogQueryFilters) => {
  const { search } = filters
  const includesUtilityKeyword = search?.toLowerCase().includes('utility')
  let where = SQL``
  if (!includesUtilityKeyword) {
    where = SQL`WHERE mv_builder_server_items_utility.utility % ${search}`
  }

  // Reduce the weight of the utility similarity so it doesn't overshadow the rest of the search
  const similarityColumn = SQL`similarity(mv_builder_server_items_utility.utility, ${search}) * 0.5`

  const query = SQL`SELECT mv_builder_server_items_utility.item_id as id, 'utility' as match_type, '' as word, `
  // If the utility keyword is included in the search, we want to give it a higher weight to items with utility
  if (includesUtilityKeyword) {
    query.append(wrapQuery(similarityColumn, SQL`GREATEST(`, SQL`, 0.01)`))
  } else {
    query.append(similarityColumn)
  }
  query
    .append(SQL` AS word_similarity FROM mv_builder_server_items_utility LEFT JOIN `)
    .append(schemaVersion)
    .append(SQL`.items AS items ON items.id = mv_builder_server_items_utility.item_id `)
    .append(where)
    .append(SQL` ORDER BY word_similarity DESC, items.first_listed_at DESC`)

  return query
}

const getItemIdsByTagOrNameQuery = (schemaVersion: string, filters: CatalogQueryFilters) => {
  const { search } = filters
  const query = getSearchCTEs(schemaVersion, filters).append(
    SQL`SELECT 
        items.id,
        CASE WHEN builder_server_items.item_id IS NULL THEN 'name' ELSE 'tag' END AS match_type,
        word.text AS word,
        similarity(word.text, ${search}) AS word_similarity
      `
      .append(' FROM ')
      .append(schemaVersion)
      .append(
        `.items AS items 
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
          .append(schemaVersion)
          .append(
            SQL`.metadata AS metadata 
                LEFT JOIN `
              .append(schemaVersion)
              .append(
                SQL`.wearable AS wearable ON metadata.wearable = wearable.id AND metadata.item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1')
                LEFT JOIN `.append(schemaVersion)
                  .append(SQL`.emote AS emote ON metadata.emote = emote.id AND metadata.item_type = 'emote_v1'
        ) AS metadata ON metadata.id = latest_metadata.id
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

export const getItemIdsBySearchTextQuery = (schemaVersion: string, filters: CatalogQueryFilters) => {
  const utilityQuery = getItemIdsByUtilityQuery(schemaVersion, filters)
  const tagOrNameQuery = getItemIdsByTagOrNameQuery(schemaVersion, filters)

  return SQL`SELECT DISTINCT ON (id) id,
      word_similarity,
      match_type,
      word
      FROM ((`
    .append(utilityQuery)
    .append(SQL`) UNION (`)
    .append(tagOrNameQuery).append(SQL`)) AS items_found
      ORDER BY id DESC, word_similarity DESC
    `)
}

export function getOrderBy(filters: CatalogFilters) {
  const { sortBy, sortDirection, isOnSale, search, ids } = filters
  const sortByParam = sortBy ?? CatalogSortBy.NEWEST
  const sortDirectionParam = sortDirection ?? CatalogSortDirection.DESC

  // When seeing "Not for sale", the only sort available is the Newest one
  if (isOnSale === false && sortByParam !== CatalogSortBy.NEWEST) {
    return ''
  }

  if (search && ids?.length) {
    // If the filters have a search term, there's no other Sort applied and ids matching the search were returned, then
    // we need to order by the position of the item in the search results that is pre-computed and passed in the ids filter.
    return SQL`ORDER BY array_position(${ids}::text[], id) `
  }

  let sortByQuery: SQLStatement | string = `ORDER BY first_listed_at ${sortDirectionParam}\n`
  switch (sortByParam) {
    case CatalogSortBy.NEWEST:
      sortByQuery = 'ORDER BY first_listed_at desc NULLS last, id desc \n'
      break
    case CatalogSortBy.MOST_EXPENSIVE:
      sortByQuery = 'ORDER BY max_price desc \n'
      break
    case CatalogSortBy.RECENTLY_LISTED: {
      // for ETHEREUM, sort by the items.created_at as the first_listed_at field
      // for MATIC use collection_minters.first_listed_at
      //  if NO network is specified, it's asking for the SORT of the multi-network query, so use the first_listed_at that will be defined in each of the networks query
      const firstListedAtColumn =
        filters.network === Network.ETHEREUM
          ? 'items.created_at as first_listed_at'
          : filters.network === Network.MATIC
          ? 'collection_minters.first_listed_at'
          : 'first_listed_at'
      sortByQuery = SQL`ORDER BY GREATEST(max_order_created_at, `.append(firstListedAtColumn).append(') desc \n')
      break
    }
    case CatalogSortBy.RECENTLY_SOLD:
      sortByQuery = 'ORDER BY sold_at desc nulls last \n'
      break
    case CatalogSortBy.CHEAPEST:
      sortByQuery = 'ORDER BY min_price asc, first_listed_at desc \n'
      break
  }

  return sortByQuery
}

export const addQuerySort = (query: SQLStatement, filters: CatalogQueryFilters) => {
  const { sortBy, sortDirection } = filters
  if (sortBy && sortDirection) {
    query.append(getOrderBy(filters))
  }
}

export const addQueryPagination = (query: SQLStatement, filters: CatalogQueryFilters) => {
  const { limit, offset } = filters
  if (limit !== undefined && offset !== undefined) {
    query.append(SQL`LIMIT ${limit} OFFSET ${offset}`)
  }
}

const getMultiNetworkQuery = (schemas: Record<string, string>, filters: CatalogQueryFilters) => {
  const { sortBy, sortDirection, limit, offset, ...restOfFilters } = filters
  const queries = Object.entries(schemas).map(([network, schema]) =>
    getCollectionsItemsCatalogQuery(schema, {
      ...restOfFilters,
      network: network as Network
    })
  )

  // The following code wraps the UNION query in a subquery so we can get the total count of items before applying the limit and offset
  const unionQuery = SQL`SELECT *, COUNT(*) OVER() as total FROM (\n`
  queries.forEach((query, index) => {
    unionQuery.append(query)
    if (queries[index + 1]) {
      unionQuery.append(SQL`\n UNION ALL ( \n`)
    }
  })
  unionQuery.append(SQL`\n)) as temp \n`)
  addQuerySort(unionQuery, filters)
  if (limit !== undefined && offset !== undefined) {
    unionQuery.append(SQL`LIMIT ${limit} OFFSET ${offset}`)
  }
  return unionQuery
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

const WEARABLE_ACCESSORIES_CATEGORIES = [
  WearableCategory.EARRING,
  WearableCategory.EYEWEAR,
  WearableCategory.HAT,
  WearableCategory.HELMET,
  WearableCategory.MASK,
  WearableCategory.TIARA,
  WearableCategory.TOP_HEAD
]

const WEARABLE_HEAD_CATEGORIES = [
  WearableCategory.EYEBROWS,
  WearableCategory.EYES,
  WearableCategory.FACIAL_HAIR,
  WearableCategory.HAIR,
  WearableCategory.MOUTH
]

export const getWearableCategoryWhere = (filters: CatalogFilters) => {
  if (filters.isWearableAccessory) {
    return SQL`metadata_wearable.category IN `.append(
      SQL`
          (`.append(WEARABLE_ACCESSORIES_CATEGORIES.map(itemType => `'${itemType}'`).join(', ')).append(SQL`
          )
          `)
    )
  } else if (filters.isWearableHead) {
    return SQL`metadata_wearable.category IN `.append(
      SQL`
          (`
        .append(WEARABLE_HEAD_CATEGORIES.map(itemType => `'${itemType}'`).join(', '))
        .append(SQL`)`)
    )
  }
  return WearableCategory.validate(filters.wearableCategory)
    ? SQL`metadata_wearable.category = '`.append(filters.wearableCategory).append(SQL`'`)
    : undefined
}

export const getEmoteCategoryWhere = (filters: CatalogFilters) => {
  return EmoteCategory.validate(filters.emoteCategory)
    ? SQL`metadata_emote.category ILIKE '`.append(filters.emoteCategory).append(SQL`'`)
    : undefined
}

export const getEmotePlayModeWhere = (filters: CatalogFilters) => {
  return Array.isArray(filters.emotePlayMode)
    ? filters.emotePlayMode.length === 1
      ? SQL`metadata_emote.loop = ${filters.emotePlayMode[0] === EmotePlayMode.LOOP}`
      : undefined
    : SQL`metadata_emote.loop = ${filters.emotePlayMode === EmotePlayMode.LOOP}`
}

export const getEmoteHasGeometryWhere = (filters: CatalogFilters) => {
  return filters.network === Network.MATIC ? SQL`metadata_emote.has_geometry = true` : undefined
}

export const getEmoteHasSoundWhere = (filters: CatalogFilters) => {
  return filters.network === Network.MATIC ? SQL`metadata_emote.has_sound = true` : undefined
}

export const getSearchWhere = (filters: CatalogFilters) => {
  return SQL`word.text % ${filters.search}`
}

export const getIsSoldOutWhere = () => {
  return SQL`items.available = 0`
}

export const getIsOnSaleJoin = (schemaVersion: string) => {
  const join = SQL`
          LEFT JOIN `

  return join
    .append(schemaVersion)
    .append(SQL`.collection_minters_view AS collection_minters ON items.collection = collection_minters.collection_id `)
}

export const getIsCollectionApprovedJoin = (schemaVersion: string, filters: CatalogFilters) => {
  return filters.network === Network.ETHEREUM
    ? SQL` `
    : SQL`JOIN `
        .append(schemaVersion)
        .append(
          SQL`.collection_set_approved_events_view AS collection_set_approved_events ON items.collection = collection_set_approved_events.collection_id AND collection_set_approved_events.value = true `
        )
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
  return parsedGenders.length ? SQL`metadata_wearable.body_shapes @> (${parsedGenders})` : undefined
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
  return filters.network === Network.ETHEREUM
    ? SQL`min_price >= ${filters.minPrice} `
    : SQL`(min_price >= ${filters.minPrice} 
            OR (COALESCE(latest_prices.price, items.price) >= ${filters.minPrice} 
              AND (items.max_supply - COALESCE(nfts.nfts_count, 0)) > 0 
              AND (item_set_minter_event.value = true OR collection_minters.is_store_minter = true)
            )
          ) `
}

export const getMaxPriceWhere = (filters: CatalogFilters) => {
  return filters.network === Network.ETHEREUM
    ? SQL`max_price <= ${filters.maxPrice} `
    : SQL`(max_price <= ${filters.maxPrice} 
            OR (COALESCE(latest_prices.price, items.price) <= ${filters.maxPrice} 
                AND (items.max_supply - COALESCE(nfts.nfts_count, 0)) > 0 
                AND (item_set_minter_event.value = true OR collection_minters.is_store_minter = true)
              )
          ) `
}

export const getContractAddressWhere = (filters: CatalogFilters) => {
  return SQL`items.collection = ANY(${filters.contractAddresses})`
}

export const getOnlyListingsWhere = (filters: CatalogFilters) => {
  return filters.network === Network.ETHEREUM
    ? SQL`listings_count > 0 `
    : SQL`(
                COALESCE((item_set_minter_event.value = true OR collection_minters.is_store_minter = true), false) is false
                OR ((item_set_minter_event.value = true OR collection_minters.is_store_minter = true) AND (items.max_supply - COALESCE(nfts.nfts_count, 0)) = 0)
              ) AND listings_count > 0`
}

export const getOnlyMintingWhere = () => {
  return SQL`(item_set_minter_event.value = true OR collection_minters.is_store_minter = true) AND (items.max_supply - COALESCE(nfts.nfts_count, 0)) > 0`
}

export const getIdsWhere = (filters: CatalogFilters) => {
  return SQL`items.id = ANY(${filters.ids})`
}

export const getIsOnSale = (filters: CatalogFilters) => {
  return filters.isOnSale
    ? filters.network === Network.MATIC
      ? SQL`(((item_set_minter_event.value = true OR collection_minters.is_store_minter = true) AND (items.max_supply - COALESCE(nfts.nfts_count, 0)) > 0) OR listings_count IS NOT NULL)`
      : SQL`listings_count IS NOT NULL`
    : filters.network === Network.ETHEREUM
    ? SQL`listings_count IS NULL`
    : SQL`listings_count IS NULL AND COALESCE((item_set_minter_event.value = true OR collection_minters.is_store_minter = true), false) is false`
}

export const getCollectionsQueryWhere = (filters: CatalogFilters) => {
  const conditions = [
    filters.category ? getCategoryWhere(filters) : undefined,
    filters.rarities?.length ? getRaritiesWhere(filters) : undefined,
    filters.creator?.length ? getCreatorWhere(filters) : undefined,
    filters.isSoldOut ? getIsSoldOutWhere() : undefined,
    filters.isOnSale !== undefined ? getIsOnSale(filters) : undefined,
    filters.wearableCategory || filters.isWearableAccessory || filters.isWearableHead ? getWearableCategoryWhere(filters) : undefined,
    filters.wearableGenders?.length ? getWearableGenderWhere(filters) : undefined,
    filters.emoteCategory ? getEmoteCategoryWhere(filters) : undefined,
    filters.emotePlayMode?.length ? getEmotePlayModeWhere(filters) : undefined,
    filters.emoteHasGeometry ? getEmoteHasGeometryWhere(filters) : undefined,
    filters.emoteHasSound ? getEmoteHasSoundWhere(filters) : undefined,
    filters.contractAddresses?.length ? getContractAddressWhere(filters) : undefined,
    filters.minPrice ? getMinPriceWhere(filters) : undefined,
    filters.maxPrice ? getMaxPriceWhere(filters) : undefined,
    filters.onlyListing ? getOnlyListingsWhere(filters) : undefined,
    filters.onlyMinting ? getOnlyMintingWhere() : undefined,
    filters.ids?.length ? getIdsWhere(filters) : undefined
  ].filter(Boolean)

  const where = SQL`WHERE `

  if (!conditions.length) {
    return SQL` `
  }

  conditions.forEach((condition, index) => {
    if (condition) {
      where.append(condition)
      if (conditions[index + 1]) {
        where.append(SQL` AND `)
      }
    }
  })

  return where.append(`
  `)
}

const getMinPriceCase = (filters: CatalogQueryFilters) => {
  return filters.network === Network.ETHEREUM
    ? SQL`nfts_with_orders.min_price::numeric as min_price `
    : SQL`
          CASE
            WHEN (items.max_supply - COALESCE(nfts.nfts_count, 0)) > 0 AND (item_set_minter_event.value = true OR collection_minters.is_store_minter = true)
                  `
        .append(filters.minPrice ? SQL`AND COALESCE(latest_prices.price, items.price) >= ${filters.minPrice} ` : SQL` `)
        .append(
          SQL`
              THEN LEAST(COALESCE(latest_prices.price, items.price), nfts_with_orders.min_price) 
              ELSE nfts_with_orders.min_price 
          END AS min_price 
        `
        )
}

const getMaxPriceCase = (filters: CatalogQueryFilters) => {
  return filters.network === Network.ETHEREUM
    ? SQL`nfts_with_orders.max_price::numeric as max_price `
    : SQL`
          CASE
            WHEN (items.max_supply - COALESCE(nfts.nfts_count, 0)) > 0 AND (item_set_minter_event.value = true OR collection_minters.is_store_minter = true)
                  `
        .append(filters.maxPrice ? SQL`AND COALESCE(latest_prices.price, items.price) <= ${filters.maxPrice} ` : SQL` `)
        .append(
          SQL`
              THEN GREATEST(COALESCE(latest_prices.price, items.price), nfts_with_orders.max_price)
              ELSE nfts_with_orders.max_price 
          END AS max_price 
          `
        )
}

const getOwnersViewJoin = (schemaVersion: string) => {
  return SQL`LEFT JOIN `
    .append(schemaVersion)
    .append('.nfts_owners_view AS nfts_with_owners_count ON nfts_with_owners_count.item = items.id ')
}

const getNFTsViewJoin = (schemaVersion: string) => {
  return SQL`
        LEFT JOIN `
    .append(schemaVersion)
    .append(SQL`.nfts_view as nfts ON nfts.item = items.id `)
}

const getLatestMetadataJoin = (filters: CatalogQueryFilters) => {
  return filters.network === Network.ETHEREUM
    ? SQL`
        LEFT JOIN latest_metadata ON latest_metadata.item_id = items.metadata ` // TODO: This will be fix during next indexation, is a workaround for the current one
    : SQL`
        LEFT JOIN latest_metadata ON latest_metadata.item_id = items.id `
}

const getEventsTableJoins = (schemaVersion: string) => {
  return SQL`
        LEFT JOIN `
    .append(schemaVersion)
    .append(SQL`.item_set_minter_event_view AS item_set_minter_event ON items.id = item_set_minter_event.item_id `)
}

const getOrdersViewJoin = (schemaVersion: string, filters: CatalogQueryFilters) => {
  const join = SQL`
        LEFT JOIN `
    .append(schemaVersion)
    .append(SQL`.nfts_with_orders_view AS nfts_with_orders ON nfts_with_orders.item = items.id `)
  if (filters.minPrice) {
    join.append(SQL`AND nfts_with_orders.min_price >= ${filters.minPrice} `)
  }
  if (filters.maxPrice) {
    join.append(SQL`AND nfts_with_orders.max_price <= ${filters.maxPrice} `)
  }
  return join
}

const getLatestPriceViewJoin = (schemaVersion: string) => {
  return SQL` 
        LEFT JOIN `
    .append(schemaVersion)
    .append(SQL`.latest_prices_view as latest_prices ON latest_prices.item_id = items.id`)
}

const addMetadataJoins = (schemaVersion: string, filters: CatalogQueryFilters) => {
  const wearablesJoin = SQL`
        LEFT JOIN (
          SELECT 
          metadata.id, 
          wearable.description, 
          wearable.category, 
          wearable.body_shapes, 
          wearable.name
        FROM `
    .append(schemaVersion)
    .append('.wearable AS wearable JOIN ')
    .append(schemaVersion).append(SQL`.metadata AS metadata ON metadata.wearable = wearable.id
        ) AS metadata_wearable ON metadata_wearable.id = latest_metadata.id AND (items.item_type = 'wearable_v1' OR items.item_type = 'wearable_v2' OR items.item_type = 'smart_wearable_v1') 
  `)

  const emoteJoin = SQL` 
        LEFT JOIN (
          SELECT 
            metadata.id, 
            emote.description,
            emote.category, 
            emote.body_shapes, 
            emote.name, 
            emote.loop`
    .append(
      filters.network === Network.MATIC
        ? SQL` ,
            emote.has_geometry, 
            emote.has_sound`
        : ''
    )
    .append(
      SQL`
          FROM `
    )
    .append(schemaVersion)
    .append('.emote AS emote JOIN ')
    .append(schemaVersion).append(SQL`.metadata AS metadata ON metadata.emote = emote.id
        ) AS metadata_emote ON metadata_emote.id = latest_metadata.id AND items.item_type = 'emote_v1' 
  `)

  switch (filters.category) {
    case NFTCategory.WEARABLE:
      return wearablesJoin
    case NFTCategory.EMOTE:
      return emoteJoin
    default:
      return wearablesJoin.append(emoteJoin)
  }
}

const getItemSoldAtJoin = (schemaVersion: string) => {
  return SQL`LEFT JOIN `.append(schemaVersion).append(SQL`.item_sold_at_view AS item_sold_at_view ON item_sold_at_view.item = items.id `)
}

const getLatestMetadataCTE = (schemaVersion: string) => {
  return SQL`latest_metadata AS (
        SELECT DISTINCT ON (item_id) item_id, id, item_type, wearable, emote, timestamp 
        FROM `.append(schemaVersion).append(SQL`.metadata 
        ORDER BY item_id, timestamp DESC
      )
    `)
}

const getCTEs = (schemaVersion: string) => {
  return SQL`WITH `.append(getLatestMetadataCTE(schemaVersion))
}

const getSearchCTEs = (schemaVersion: string, filters: CatalogQueryFilters) => {
  return SQL`WITH `.append(getLatestMetadataCTE(schemaVersion)).append(
    SQL`, builder_server_items AS (
      SELECT 
      item_id,
      tag
    FROM 
      mv_builder_server_items
    WHERE
      LOWER(tag) = LOWER(${filters.search})
    )
  `
  )
}

const getMetadataSelect = (filters: CatalogQueryFilters) => {
  switch (filters.category) {
    case NFTCategory.WEARABLE:
      return SQL`to_json(metadata_wearable) as metadata,`
    case NFTCategory.EMOTE:
      return SQL`to_json(metadata_emote) as metadata,`
    default:
      return SQL`
        to_json(
          CASE 
            WHEN latest_metadata.item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1') THEN metadata_wearable 
            WHEN latest_metadata.item_type = 'emote_v1' THEN metadata_emote 
            ELSE null
          END
        ) as metadata,
      `
  }
}

const getFirstListedAtField = (filters: CatalogFilters) => {
  if (filters.network === Network.ETHEREUM) {
    return SQL`items.created_at as first_listed_at,`
  }
  return SQL`collection_minters.first_listed_at first_listed_at,`
}

const getIsSearchStoreMinter = (filters: CatalogFilters) => {
  return filters.network === Network.ETHEREUM
    ? SQL`false as search_is_store_minter,`
    : SQL`COALESCE((item_set_minter_event.value = true OR collection_minters.is_store_minter = true), false) as search_is_store_minter,`
}

export const getCollectionsItemsCatalogQuery = (schemaVersion: string, filters: CatalogQueryFilters) => {
  const query = getCTEs(schemaVersion).append(
    SQL`
      SELECT
          COUNT(*) OVER() as total_rows,
          items.id,
          items.blockchain_id,
          `
      .append(getMetadataSelect(filters))
      .append(
        SQL`
          items.image,
          items.collection,
          items.rarity,
          items.item_type::text,
          COALESCE(latest_prices.price, items.price) AS price,
          (items.max_supply - COALESCE(nfts.nfts_count, 0)) AS available,
          `
      )
      .append(getIsSearchStoreMinter(filters))
      .append(
        SQL`
          items.creator,
          items.beneficiary,
          items.created_at,
          items.updated_at,
          items.reviewed_at,
          item_sold_at_view.max as sold_at,
          ${filters.network} as network,
          `
          .append(getFirstListedAtField(filters))
          .append(
            SQL`
          nfts_with_orders.min_price::numeric AS min_listing_price,
          nfts_with_orders.max_price::numeric AS max_listing_price, 
          COALESCE(nfts_with_orders.listings_count,0) as listings_count,`
              .append(
                filters.isOnSale === false
                  ? SQL`
          nfts_with_owners_count.owners_count,`
                  : SQL``
              )
              .append(
                `
          nfts_with_orders.max_order_created_at as max_order_created_at,
          `
              )
              .append(getMinPriceCase(filters))
              .append(',')
              .append(getMaxPriceCase(filters))
              .append(
                `
        FROM `
              )
              .append(schemaVersion)
              .append(
                `.items AS items 
          `
              )
              .append(filters.isOnSale === false ? getOwnersViewJoin(schemaVersion) : SQL``)
              .append(getNFTsViewJoin(schemaVersion))
              .append(getOrdersViewJoin(schemaVersion, filters))
              .append(getLatestPriceViewJoin(schemaVersion))
              .append(getIsOnSaleJoin(schemaVersion))
              .append(getLatestMetadataJoin(filters))
              .append(addMetadataJoins(schemaVersion, filters))
              .append(getItemSoldAtJoin(schemaVersion))
              .append(getIsCollectionApprovedJoin(schemaVersion, filters))
              .append(getEventsTableJoins(schemaVersion))
              .append(getCollectionsQueryWhere(filters))
          )
      )
  )
  addQuerySort(query, filters)
  addQueryPagination(query, filters)
  return query
}

export const getCatalogQuery = (schemas: Record<string, string>, filters: CatalogFilters) => {
  if (Object.values(schemas).length > 1) {
    return getMultiNetworkQuery(schemas, filters)
  }
  return getCollectionsItemsCatalogQuery(Object.values(schemas)[0], filters)
}
