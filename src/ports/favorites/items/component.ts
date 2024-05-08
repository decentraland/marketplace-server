import { isErrorWithMessage } from '../../../logic/errors'
import { getLatestSchemas } from '../../../logic/substreams/utils'
import { AppComponents } from '../../../types'
import { QueryFailure } from '../lists/errors'
import { ItemNotFoundError } from './errors'
import { getItemById } from './queries'
import { IItemsComponent } from './types'

export function createItemsComponent(components: Pick<AppComponents, 'substreamsDatabase' | 'logs'>): IItemsComponent {
  const { substreamsDatabase, logs } = components
  const logger = logs.getLogger('Items component')

  async function validateItemExists(itemId: string): Promise<void> {
    const client = await substreamsDatabase.getPool().connect()
    try {
      const schemas = await getLatestSchemas(client)
      const items = []
      for (const schema of schemas) {
        const searchQuery = getItemById(schema, itemId)
        const filteredItemsById = await client.query<{
          id: string
        }>(searchQuery)
        items.push(...filteredItemsById.rows)
      }

      if (items.length === 0) {
        throw new ItemNotFoundError(itemId)
      }
    } catch (error) {
      if (error instanceof ItemNotFoundError) throw error

      logger.error('Querying the substreams database failed.')
      throw new QueryFailure(isErrorWithMessage(error) ? error.message : 'Unknown')
    } finally {
      client.release()
    }
  }

  return { validateItemExists }
}
