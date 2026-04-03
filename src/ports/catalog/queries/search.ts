import SQL, { SQLStatement } from 'sql-template-strings'
import { Network } from '@dcl/schemas'
import { BUILDER_SERVER_TABLE_SCHEMA, MARKETPLACE_SQUID_SCHEMA } from '../../../constants'
import { CatalogQueryFilters } from '../types'
import { getSearchWhere } from './filters'
import { getWhereWordsJoin } from './fragments'

const getBuilderServerTagsJoin = () => {
  return SQL`LEFT JOIN builder_server_items ON builder_server_items.item_id = items.id::text `
}

const wrapQuery = (statement: SQLStatement, start: SQLStatement, end: SQLStatement) => start.append(statement).append(end)

const getLatestMetadataJoin = (filters: CatalogQueryFilters) => {
  return filters.network === Network.ETHEREUM
    ? SQL`
        LEFT JOIN latest_metadata ON latest_metadata.item_id = items.metadata ` // TODO: This will be fix during next indexation, is a workaround for the current one
    : SQL`
        LEFT JOIN latest_metadata ON latest_metadata.item_id = items.id `
}

const getLatestMetadataCTE = () => {
  return SQL`latest_metadata AS (
        SELECT DISTINCT ON (COALESCE(m.wearable_id::text, m.emote_id::text))
          CASE
            WHEN m.network = 'ETHEREUM'
                 THEN (COALESCE(w.collection, e.collection)) || '-' || m.id -- Use collection + '-' + metadata.id for L1 items
            ELSE COALESCE(m.wearable_id::text, m.emote_id::text)
            END AS item_id,
        m.id AS latest_metadata_id,
          m.item_type,
          m.wearable_id,
          m.emote_id
        FROM
          `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.metadata as m
          LEFT JOIN `
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`.wearable AS w
          ON w.id = m.wearable_id
          LEFT JOIN `.append(MARKETPLACE_SQUID_SCHEMA).append(SQL`.emote AS e
        ON e.id = m.emote_id
        ORDER BY COALESCE(m.wearable_id::text, m.emote_id::text) DESC
      )
    `)
        )
    )
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

export const getItemIdsByUtilityQuery = (filters: CatalogQueryFilters) => {
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

export const getItemIdsByTagOrNameQuery = (filters: CatalogQueryFilters) => {
  const { search } = filters
  const query = getSearchCTEs(filters).append(
    SQL`SELECT
        items.id AS id,
        CASE WHEN builder_server_items.item_id IS NULL THEN 'name' ELSE 'tag' END AS match_type,
        word.text AS word,
        similarity(lower(word.text), lower(${search})) AS word_similarity
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
