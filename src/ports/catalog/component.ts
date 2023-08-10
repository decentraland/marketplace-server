import { Item, NFTCategory, Network, getChainName } from '@dcl/schemas'
import { getPolygonChainId, getEthereumChainId } from '../../logic/chainIds'
import { HttpError } from '../../logic/http/response'
import { AppComponents } from '../../types'
import { getCatalogQuery, getItemIdsBySearchTextQuery, getLatestChainSchema } from './queries'
import { CatalogOptions, CollectionsItemDBResult, ICatalogComponent } from './types'
import { fromCollectionsItemDbResultToCatalogItem } from './utils'

export async function createCatalogComponent(components: Pick<AppComponents, 'database'>): Promise<ICatalogComponent> {
  const { database } = components

  async function fetch(filters: CatalogOptions) {
    const { network, creator, category } = filters
    const marketplaceChainId = getEthereumChainId()
    const collectionsChainId = getPolygonChainId()
    let catalogItems: Item[] = []
    let total = 0
    const client = await database.getPool().connect()
    try {
      const networks = network
        ? [network]
        : (creator && creator.length) || (category && category === NFTCategory.EMOTE)
        ? [Network.MATIC]
        : [Network.ETHEREUM, Network.MATIC]
      const sources = networks.reduce((acc, curr) => {
        acc[curr] = getChainName(curr === Network.ETHEREUM ? marketplaceChainId : collectionsChainId) || ''
        return acc
      }, {} as Record<string, string>)

      const latestSchemasPromises: Promise<Record<string, string>>[] = Object.entries(sources).map(async ([network, chainName]) => {
        const query = getLatestChainSchema(chainName)
        console.log('query.text: ', query.text)
        console.log('query.values: ', query.values)
        const schemaName = await client.query<{
          entity_schema: string
        }>(query)
        return {
          [network]: schemaName.rows[0].entity_schema
        }
      })

      const schemas = await Promise.all(latestSchemasPromises)
      const reducedSchemas = schemas.reduce((acc, curr) => ({ ...acc, ...curr }), {})

      if (filters.search) {
        for (const schema of Object.values(reducedSchemas)) {
          const filteredItemsById = await client.query<CollectionsItemDBResult>(getItemIdsBySearchTextQuery(schema, filters.search))
          if (filteredItemsById.rowCount === 0) {
            // if no items matched the search text, return empty result
            return { data: [], total: 0 }
          }
          filters.ids = [...(filters.ids ?? []), ...filteredItemsById.rows.map(({ id }) => id)]
        }
      }
      const query = getCatalogQuery(reducedSchemas, filters)
      console.log('query: ', query.text)
      console.log('query values: ', query.values)
      const results = await client.query<CollectionsItemDBResult>(query)
      catalogItems = results.rows.map(res => fromCollectionsItemDbResultToCatalogItem(res, network))
      total = results.rows[0]?.total ?? results.rows[0]?.total_rows ?? 0

      // @TODO: add favorites enhancement logic
      // if (isFavoritesEnabled) {
      // const picksStats = await favoritesComponent.getPicksStatsOfItems(
      //   catalogItems.map(({ id }) => id),
      //   filters.pickedBy
      // )

      // catalogItems = enhanceItemsWithPicksStats(catalogItems, picksStats)
      // }
    } catch (e) {
      console.error(e)
      throw new HttpError("Couldn't fetch the catalog with the filters provided", 400)
    } finally {
      client.release()
    }

    return { data: catalogItems, total: +total }
  }

  return {
    fetch
  }
}
