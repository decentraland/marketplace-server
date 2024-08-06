import { isErrorWithMessage } from '../../../logic/errors'
import { AppComponents } from '../../../types'
import { QueryFailure } from '../lists/errors'
import { ItemNotFoundError } from './errors'
import { getItemById } from './queries'
import { IItemsComponent } from './types'

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

  return { validateItemExists }
}
