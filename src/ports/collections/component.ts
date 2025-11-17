import { fromDBCollectionToCollection } from '../../adapters/collections'
import { AppComponents } from '../../types'
import { getCollectionsCountQuery, getCollectionsQuery } from './queries'
import { CollectionFilters, DBCollection, ICollectionsComponent } from './types'

/**
 * Creates the Collections component
 *
 * Orchestrates collection data retrieval operations:
 * 1. Queries the database for collection information
 * 2. Applies filtering, sorting, and pagination
 * 3. Maps database records to Collection schema format
 *
 * @param components Required components: dappsDatabase
 * @returns ICollectionsComponent implementation
 */
export function createCollectionsComponent(components: Pick<AppComponents, 'dappsDatabase'>): ICollectionsComponent {
  const { dappsDatabase: pg } = components

  /**
   * Retrieves collections based on provided filters
   *
   * This method queries the database for collection records and returns paginated results
   * with the total count. All queries are executed in parallel for performance.
   *
   * @param filters - Optional filters for querying collections (pagination, sorting, search, etc.)
   * @returns Promise resolving to an object containing the collection data array and total count
   */
  async function getCollections(filters: CollectionFilters = {}) {
    const [collections, count] = await Promise.all([
      pg.query<DBCollection>(getCollectionsQuery(filters)),
      pg.query<{ count: string }>(getCollectionsCountQuery(filters))
    ])
    return { data: collections.rows.map(fromDBCollectionToCollection), total: Number(count.rows?.[0]?.count ?? 0) }
  }

  return {
    getCollections
  }
}
