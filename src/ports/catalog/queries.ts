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
import { getCollectionStoreAddress } from '../../logic/contracts'
import { CatalogQueryFilters } from './types'
import { FragmentItemType } from './utils'

const SCHEMA_PREFIX = 'dcl'
const MAX_ORDER_TIMESTAMP = 253378408747000 // some orders have a timestmap that can't be cast by Postgres, this is the max possible value

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
        ORDER BY CAST(SUBSTRING(information.schema_name FROM 'dcl([0-9]+)') AS INTEGER) 
        desc LIMIT 1
      `
    const getLatestSchemaResult = await database.query<{ schema_name: string }>(query)
    schema = getLatestSchemaResult.rows[0]?.schema_name
  } catch (error) {
    console.log('error:', error)
  }
  return schema
}

export const getItemIdsBySearchTextQuery = (schemaVersion: string, search: CatalogQueryFilters['search']) => {
  const query = SQL`SELECT items.id`
    .append(' FROM ')
    .append(schemaVersion)
    .append('.item AS items WHERE ')
    .append(getSearchWhere({ search }))

  return query
}

export function getOrderBy(filters: CatalogFilters) {
  const { sortBy, sortDirection, isOnSale } = filters
  const sortByParam = sortBy ?? CatalogSortBy.NEWEST
  const sortDirectionParam = sortDirection ?? CatalogSortDirection.DESC

  // When seeing "Not for sale", the only sort available is the Newest one
  if (isOnSale === false && sortByParam !== CatalogSortBy.NEWEST) {
    return ''
  }

  let sortByQuery: SQLStatement | string = `ORDER BY first_listed_at ${sortDirectionParam}\n`
  switch (sortByParam) {
    case CatalogSortBy.NEWEST:
      sortByQuery = 'ORDER BY first_listed_at desc NULLS last, id \n'
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
  console.log('unionQuery: ', unionQuery.text)
  console.log('unionQuery: ', unionQuery.values)
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
  return SQL`items.search_text ILIKE '%' || ${filters.search} || '%'`
}

export const getIsSoldOutWhere = () => {
  return SQL`items.available = 0`
}

export const getIsOnSaleJoin = (schemaVersion: string, _filters: CatalogFilters) => {
  return SQL` LEFT JOIN (
    SELECT collection_id,
      value,
      timestamp,
      ROW_NUMBER() OVER (PARTITION BY collection_id ORDER BY timestamp DESC) AS row_num
    FROM `.append(schemaVersion).append(SQL`.collection_set_global_minter_events
    WHERE search_is_store_minter = true
    AND minter = ${getCollectionStoreAddress()}
  ) AS collection_minters ON collections.id = collection_minters.collection_id AND collection_minters.row_num = 1   
  `)
}

export const getIsCollectionApprovedJoin = (schemaVersion: string) => {
  return SQL`
  JOIN (
    SELECT
      collection_id,
      value,
      timestamp,
      ROW_NUMBER() OVER (
        PARTITION BY collection_id
        ORDER BY timestamp DESC
      ) AS row_num
    FROM `.append(schemaVersion).append(SQL`.collection_set_approved_events
    WHERE value = true
  ) AS collection_set_approved_events ON items.collection = collection_set_approved_events.collection_id AND collection_set_approved_events.row_num = 1`)
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
  return SQL`items.collection = ANY(${filters.contractAddresses})`
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

export const getCollectionsQueryWhere = (filters: CatalogFilters) => {
  const conditions = [
    filters.category ? getCategoryWhere(filters) : undefined,
    filters.rarities?.length ? getRaritiesWhere(filters) : undefined,
    filters.creator?.length ? getCreatorWhere(filters) : undefined,
    filters.isSoldOut ? getIsSoldOutWhere() : undefined,
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
    filters.ids?.length ? getIdsWhere(filters) : undefined
  ].filter(Boolean)

  const result =
    filters.network !== Network.ETHEREUM && filters.isOnSale
      ? SQL`WHERE (item_set_minter_event.value = true OR collection_minters.value = true) `
      : SQL``
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

const getMinPriceCase = (filters: CatalogQueryFilters) => {
  return SQL`CASE
                  WHEN (items.max_supply::numeric - COALESCE(nfts.nfts_count, 0)) > 0 AND item_set_minter_event.value = true
                  `.append(filters.minPrice ? SQL`AND COALESCE(latest_prices.price, items.price) >= ${filters.minPrice}` : SQL``)
    .append(` THEN LEAST(COALESCE(latest_prices.price, items.price), nfts_with_orders.min_price) 
                                  ELSE nfts_with_orders.min_price 
                                END AS min_price
                              `)
}

const getMaxPriceCase = (filters: CatalogQueryFilters) => {
  return SQL`CASE
                  WHEN (items.max_supply::numeric - COALESCE(nfts.nfts_count, 0)) > 0 AND item_set_minter_event.value = true
                  `.append(filters.maxPrice ? SQL`AND COALESCE(latest_prices.price, items.price) <= ${filters.maxPrice}` : SQL``)
    .append(` THEN GREATEST(COALESCE(latest_prices.price, items.price), nfts_with_orders.max_price)
            ELSE nfts_with_orders.max_price 
            END AS max_price
            `)
}

const getOwnersJoin = (schemaVersion: string) => {
  return SQL` LEFT JOIN (
            SELECT item, COUNT(distinct owner) as owners_count FROM `
    .append(schemaVersion)
    .append('.nfts as nfts GROUP BY nfts.item) AS nfts ON nfts.item = items.id ')
}

const getCollectionsJoin = (schemaVersion: string) => {
  return SQL`LEFT JOIN `.append(schemaVersion).append(SQL`.collections as collections ON collections.id = items.collection `)
}

const getNFTsJoin = () => {
  return SQL`LEFT JOIN nfts ON nfts.item = items.id `
}

const getLatestMetadataJoin = () => {
  return SQL`LEFT JOIN latest_metadata ON latest_metadata.item_id = items.id `
}

const getEventsTableJoins = (schemaVersion: string) => {
  return SQL`
    LEFT JOIN (
        SELECT item_id, value, timestamp,
          ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY timestamp DESC) AS row_num
        FROM `
    .append(schemaVersion)
    .append(
      SQL`.item_minters
        WHERE minter = ${getCollectionStoreAddress()}
      ) AS item_set_minter_event ON items.id = item_set_minter_event.item_id AND item_set_minter_event.row_num = 1
    
    `
    )
}

const getLatestPriceJoin = () => {
  return SQL` LEFT JOIN (
    SELECT item_id, price, timestamp, ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY timestamp DESC) AS row_num
    FROM latest_prices
  ) AS latest_prices ON latest_prices.item_id = items.id AND latest_prices.row_num = 1 `
}

export const getCollectionsItemsCatalogQuery = (schemaVersion: string, filters: CatalogQueryFilters) => {
  const query = SQL`
            WITH nfts AS (
                SELECT item, COUNT(*) AS nfts_count
                FROM `
    .append(schemaVersion)
    .append(
      SQL`.nfts
                GROUP BY item
            ), latest_prices AS (
              SELECT DISTINCT ON (item_id)
                item_id,
                price,
                timestamp
              FROM `
        .append(schemaVersion)
        .append(
          SQL`.update_item_data_events
              ORDER BY item_id, timestamp DESC
            ),
            latest_metadata AS (
              SELECT DISTINCT ON (item_id)
                item_id,
                id,
                item_type,
                wearable,
                emote,
                timestamp
              FROM `
            .append(schemaVersion)
            .append(
              SQL`.metadata
              ORDER BY item_id, timestamp DESC
            )
            SELECT
                COUNT(*) OVER() as total_rows,
                items.id,
                items.blockchain_id,
                to_json(
                  CASE 
                    WHEN latest_metadata.item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1') THEN metadata_wearable 
                    WHEN latest_metadata.item_type = 'emote_v1' THEN metadata_emote 
                    ELSE null
                  END
                ) as metadata,
                items.image,
                items.collection,
                items.rarity,
                items.item_type::text,
                COALESCE(latest_prices.price, items.price) AS price,
                (items.max_supply::numeric - COALESCE(nfts.nfts_count, 0)) AS available,
                items.creator,
                items.beneficiary,
                items.created_at,
                items.updated_at,
                items.reviewed_at,
                items.sold_at,
                ${filters.network} as network,
                CASE
                  WHEN (items.max_supply::numeric - COALESCE(nfts.nfts_count, 0)) > 0 AND collection_minters.value = true THEN collection_minters.timestamp
                  ELSE item_set_minter_event.timestamp
                END AS first_listed_at,
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
                  `
              FROM `
                )
                .append(schemaVersion)
                .append('.items AS items ')
                .append(filters.isOnSale === false ? getOwnersJoin(schemaVersion) : SQL``)
                .append(getCollectionsJoin(schemaVersion))
                .append(getNFTsJoin())
                .append(getLatestMetadataJoin())
                .append(
                  `
              LEFT JOIN (
                SELECT 
                    nfts_with_orders.item, 
                    COUNT(nfts_with_orders.id) AS listings_count,
                    MIN(nfts_with_orders.price) AS min_price,
                    MAX(nfts_with_orders.price) AS max_price,
                    MAX(nfts_with_orders.created_at) AS max_order_created_at
                FROM (
                    SELECT  orders.item,
                            orders.id,
                            orders.price,
                            orders.created_at,
                            ROW_NUMBER() OVER (PARTITION BY orders.item ORDER BY orders.created_at DESC) AS row_num
                    FROM `
                )
                .append(schemaVersion)
                .append(
                  SQL`.orders AS orders
          WHERE 
          orders.status = 'open' 
          AND orders.expires_at < `
                )
                .append(MAX_ORDER_TIMESTAMP)
                .append(
                  ` 
          AND to_timestamp(orders.expires_at / 1000.0) > now()
          `
                )
                .append(getOrderRangePriceWhere(filters))
                .append(
                  SQL`
        ) as nfts_with_orders
        WHERE nfts_with_orders.row_num = 1 
        GROUP BY nfts_with_orders.item
        ) as nfts_with_orders ON nfts_with_orders.item = items.id`
                )
                .append(
                  `
                LEFT JOIN (
                  SELECT 
                  metadata.item_id, 
                  wearable.description, 
                  wearable.category, 
                  wearable.body_shapes, 
                  wearable.name
                FROM `
                )
                .append(schemaVersion)
                .append(
                  `.wearable AS wearable
              JOIN `
                )
                .append(schemaVersion)
                .append(
                  `.metadata AS metadata ON metadata.wearable = wearable.id
        ) AS metadata_wearable ON metadata_wearable.item_id = items.id AND (items.item_type = 'wearable_v1' OR items.item_type = 'wearable_v2' OR items.item_type = 'smart_wearable_v1')
              LEFT JOIN (
                SELECT 
                  metadata.id, 
                  emote.description, 
                  emote.category, 
                  emote.body_shapes, 
                  emote.name, 
                  emote.loop
                FROM `
                )
                .append(schemaVersion)
                .append(
                  `.emote AS emote
              JOIN `
                )
                .append(schemaVersion)
                .append(
                  `.metadata AS metadata ON metadata.emote = emote.id
              ) AS metadata_emote ON metadata_emote.id = items.metadata AND items.item_type = 'emote_v1' `
                )
                .append(getLatestPriceJoin())
                .append(getIsCollectionApprovedJoin(schemaVersion))
                .append(getIsOnSaleJoin(schemaVersion, filters))
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
