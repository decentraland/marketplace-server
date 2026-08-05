import { fromDBItemToItem } from '../../adapters/items'
import { isErrorWithMessage } from '../../logic/errors'
import { AppComponents } from '../../types'
import { QueryFailure } from '../favorites/lists/errors'
import { ItemNotFoundError } from './errors'
import { getCatalogItemsQuery, getItemById, getItemsQuery, getUtilityByItem } from './queries'
import { CatalogDBItem, DBItem, IItemsComponent, ItemQueryFilters } from './types'

// Format a MANA/USD rate (USD per MANA) as a bounded-precision decimal literal for the SQL numeric math.
// A non-positive/non-finite rate yields '0' (a MANA-priced item then converts to 0 credits) rather than
// pricing off a broken rate. Mirrors the shop-catalog component's rate handling.
function rateToNumericString(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '0'
  return rate.toFixed(18)
}

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

  async function getItems(filters: ItemQueryFilters) {
    const query = getItemsQuery(filters)
    const result = await database.query<DBItem>(query)
    const items: DBItem[] = result.rows

    if (result.rowCount > 0 && filters.contractAddresses && filters.contractAddresses.length === 1 && filters.itemId) {
      items[0].utility = (await database.query(getUtilityByItem(filters.contractAddresses[0], filters.itemId))).rows[0].utility
    }

    return {
      data: items.map(fromDBItemToItem),
      total: result.rowCount > 0 ? Number(items[0].count) : 0
    }
  }

  async function getCatalogItems(filters: ItemQueryFilters, manaUsdRate: number) {
    const query = getCatalogItemsQuery(filters, rateToNumericString(manaUsdRate))
    const result = await database.query<CatalogDBItem>(query)
    const items = result.rows

    return {
      data: items.map(item => ({ ...fromDBItemToItem(item), priceCredits: Number(item.price_credits ?? 0) })),
      total: result.rowCount > 0 ? Number(items[0].count) : 0
    }
  }

  return { validateItemExists, getItems, getCatalogItems }
}
