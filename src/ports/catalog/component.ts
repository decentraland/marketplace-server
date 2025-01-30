import { Analytics } from '@segment/analytics-node'
import SQL from 'sql-template-strings'
import { Item } from '@dcl/schemas'
import { fromDBPickStatsToPickStats } from '../../adapters/picks'
import { BUILDER_SERVER_TABLE_SCHEMA } from '../../constants'
import { enhanceItemsWithPicksStats } from '../../logic/favorites/utils'
import { HttpError } from '../../logic/http/response'
import { AppComponents } from '../../types'
import { formatQueryForLogging } from '../utils'
import { getCollectionsItemsCatalogQuery, getCollectionsItemsCatalogQueryWithTrades, getItemIdsBySearchTextQuery } from './queries'
import { CatalogOptions, CollectionsItemDBResult, ICatalogComponent } from './types'
import { fromCollectionsItemDbResultToCatalogItem } from './utils'

const sortByWordSimilarity = (a: { word_similarity: number }, b: { word_similarity: number }) => b.word_similarity - a.word_similarity

export async function createCatalogComponent(
  components: Pick<AppComponents, 'dappsDatabase' | 'dappsWriteDatabase' | 'picks'>,
  segmentWriteKey: string
): Promise<ICatalogComponent> {
  const { dappsDatabase: dataReadbase, dappsWriteDatabase, picks } = components

  async function fetch(
    filters: CatalogOptions,
    { searchId, anonId, isV2 = false }: { searchId: string; anonId: string; isV2: boolean }
  ): Promise<{ data: Item[]; total: number }> {
    const { network } = filters
    let catalogItems: Item[] = []
    let total = 0
    const client = await dataReadbase.getPool().connect()
    let query
    try {
      if (filters.search) {
        const analytics = new Analytics({ writeKey: segmentWriteKey })
        const searchQuery = getItemIdsBySearchTextQuery(filters)
        const filteredItemsById = await client.query<{
          id: string
          word: string
          match_type: string
          word_similarity: number
        }>(searchQuery)
        const trackingData = {
          event: 'Catalog Search',
          anonymousId: anonId,
          properties: {
            search: filters.search,
            searchId,
            results: filteredItemsById.rows.map(match => ({
              item_id: match.id,
              match: match.word,
              matchBy: match.match_type,
              similarity: match.word_similarity
            }))
          }
        }
        analytics.track(trackingData)
        filteredItemsById.rows.sort(sortByWordSimilarity)
        filters.ids = [...(filters.ids ?? []), ...filteredItemsById.rows.map(({ id }) => id)]

        if (filters.ids?.length === 0) {
          // if no items matched the search text, return empty result
          return { data: [], total: 0 }
        }
      }
      query = isV2 ? getCollectionsItemsCatalogQueryWithTrades(filters) : getCollectionsItemsCatalogQuery(filters)
      const results = await client.query<CollectionsItemDBResult>(query)
      catalogItems = results.rows.map(res => fromCollectionsItemDbResultToCatalogItem(res, network))
      total = results.rows[0]?.total ?? results.rows[0]?.total_rows ?? 0

      const pickStats = await picks.getPicksStats(
        catalogItems.map(({ id }) => id),
        {
          userAddress: filters.pickedBy
        }
      )

      catalogItems = enhanceItemsWithPicksStats(catalogItems, pickStats.map(fromDBPickStatsToPickStats))
    } catch (e) {
      console.error(e)
      if ((e as Error).message === 'Query read timeout') {
        const errorInfo = {
          filters: JSON.stringify(filters),
          query: query?.text ? formatQueryForLogging(query.text) : undefined,
          values: query?.values
        }
        console.error('Catalog Query timeout exceeded')
        console.dir(errorInfo, { depth: null, maxStringLength: null })
      }
      throw new HttpError("Couldn't fetch the catalog with the filters provided", 400)
    } finally {
      client.release()
    }

    return { data: catalogItems, total: +total }
  }

  async function updateBuilderServerItemsView() {
    const client = await dappsWriteDatabase.getPool().connect()
    try {
      const query = SQL`
        REFRESH MATERIALIZED VIEW `
        .append(BUILDER_SERVER_TABLE_SCHEMA)
        .append(
          SQL`.mv_builder_server_items;
        REFRESH MATERIALIZED VIEW `
        )
        .append(BUILDER_SERVER_TABLE_SCHEMA).append(SQL`.mv_builder_server_items_utility;
      `)
      await client.query(query)
    } catch (e) {
      console.error(e)
    } finally {
      client.release()
    }
  }

  return {
    fetch,
    updateBuilderServerItemsView
  }
}
