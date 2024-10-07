import { ItemFilters } from '@dcl/schemas'
import { fromDBItemToItem } from '../../adapters/items'
import { isErrorWithMessage } from '../../logic/errors'
import { AppComponents } from '../../types'
import { QueryFailure } from '../favorites/lists/errors'
import { ItemNotFoundError } from './errors'
import { getItemById, getItemsQuery, getUtilityByItem } from './queries'
import { DBItem, IItemsComponent } from './types'

export function createItemsComponent(components: Pick<AppComponents, 'dappsDatabase' | 'logs'>): IItemsComponent {
  const { dappsDatabase: database, logs } = components
  const logger = logs.getLogger('Items component')

  async function validateItemExists(itemId: string): Promise<void> {
    const client = await database.getPool().connect()
    try {
      const searchQuery = getItemById(itemId)
      const items = await client.query<{
        id: string
      }>(searchQuery)

      if (items.rows.length === 0) {
        throw new ItemNotFoundError(itemId)
      }
    } catch (error) {
      if (error instanceof ItemNotFoundError) throw error

      logger.error('Querying the dapps database failed.')
      throw new QueryFailure(isErrorWithMessage(error) ? error.message : 'Unknown')
    } finally {
      client.release()
    }
  }

  async function getItems(filters: ItemFilters) {
    const result = await database.query<DBItem>(getItemsQuery(filters))
    const items: DBItem[] = result.rows

    if (result.rowCount > 0 && filters.contractAddresses && filters.contractAddresses.length === 1 && filters.itemId) {
      items[0].utility = (await database.query(getUtilityByItem(filters.contractAddresses[0], filters.itemId))).rows[0].utility
    }

    return {
      data: items.map(fromDBItemToItem),
      total: result.rowCount > 0 ? Number(items[0].count) : 0
    }
  }

  return { validateItemExists, getItems }
}
