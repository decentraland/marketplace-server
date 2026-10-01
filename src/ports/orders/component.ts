import { OrderFilters } from '@dcl/schemas'
import { fromDBOrderToOrder } from '../../adapters/orders'
import { AppComponents } from '../../types'
import { getOrdersCountQuery, getOrdersQuery } from './queries'
import { IOrdersComponent, DBOrder } from './types'

export function createOrdersComponent(components: Pick<AppComponents, 'dappsDatabase' | 'contractStatus'>): IOrdersComponent {
  const { dappsDatabase: pg, contractStatus } = components

  async function getOrders(filters: OrderFilters) {
    const pausedContracts = contractStatus.getPausedContracts()
    const [orders, count] = await Promise.all([
      pg.query<DBOrder>(getOrdersQuery(filters, pausedContracts)),
      pg.query<{ count: number }>(getOrdersCountQuery(filters, pausedContracts))
    ])
    return { data: orders.rows.map(fromDBOrderToOrder), total: count.rows[0].count }
  }

  return {
    getOrders
  }
}
