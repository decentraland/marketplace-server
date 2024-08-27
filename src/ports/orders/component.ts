import { OrderFilters } from '@dcl/schemas'
import { fromDBOrderToOrder } from '../../adapters/orders'
import { AppComponents } from '../../types'
import { getOrdersQuery } from './queries'
import { IOrdersComponent, DBOrder } from './types'

export function createOrdersComponent(components: Pick<AppComponents, 'dappsDatabase'>): IOrdersComponent {
  const { dappsDatabase: pg } = components

  async function getOrders(filters: OrderFilters) {
    const result = await pg.query<DBOrder>(getOrdersQuery(filters))
    return { data: result.rows.map(fromDBOrderToOrder), total: result.rowCount > 0 ? result.rows[0].count : 0 }
  }

  return {
    getOrders
  }
}
