import { OrderFilters } from '@dcl/schemas'
import { fromDBOrderToOrder } from '../../adapters/orders'
import { AppComponents } from '../../types'
import { getOrdersCountQuery, getOrdersQuery } from './queries'
import { IOrdersComponent, DBOrder } from './types'

export function createOrdersComponent(components: Pick<AppComponents, 'dappsDatabase'>): IOrdersComponent {
  const { dappsDatabase: pg } = components

  async function getOrders(filters: OrderFilters) {
    const [orders, count] = await Promise.all([
      pg.query<DBOrder>(getOrdersQuery(filters)),
      pg.query<{ count: number }>(getOrdersCountQuery(filters))
    ])
    return { data: orders.rows.map(fromDBOrderToOrder), total: count.rows[0].count }
  }

  return {
    getOrders
  }
}
