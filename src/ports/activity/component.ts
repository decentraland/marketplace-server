import {
  dedupeEvents,
  isOrderFilled,
  sortByTimestampDesc,
  toBidPlacedEvent,
  toBidReceivedEvent,
  toOrderCreatedEvent,
  toOrderFilledEvent,
  toSaleBuyerEvent,
  toSaleSellerEvent,
  toTradeCreatedEvent
} from '../../adapters/activity'
import { AppComponents } from '../../types'
import { ActivityEvent, IActivityComponent } from './types'

const PER_SOURCE_LIMIT = 100
const TOTAL_CAP = 500

export function createActivityComponent(
  components: Pick<AppComponents, 'sales' | 'bids' | 'orders' | 'trades'>
): IActivityComponent {
  const { sales, bids, orders, trades } = components

  async function getUserActivity(address: string, options: { limit?: number } = {}) {
    const totalCap = options.limit ?? TOTAL_CAP
    const per = PER_SOURCE_LIMIT
    const lower = address.toLowerCase()

    const [salesAsBuyer, salesAsSeller, bidsAsBidder, bidsAsSeller, ordersAsOwner, ordersAsBuyer, userTrades] = await Promise.all([
      sales.getSales({ buyer: lower, first: per }).catch(() => ({ data: [], total: 0 })),
      sales.getSales({ seller: lower, first: per }).catch(() => ({ data: [], total: 0 })),
      bids.getBids({ bidder: lower, limit: per, offset: 0 }).catch(() => ({ data: [], count: 0 })),
      bids.getBids({ seller: lower, limit: per, offset: 0 }).catch(() => ({ data: [], count: 0 })),
      orders.getOrders({ owner: lower, first: per }).catch(() => ({ data: [], total: 0 })),
      orders.getOrders({ buyer: lower, first: per }).catch(() => ({ data: [], total: 0 })),
      trades.getTradesByAddress(lower, { limit: per }).catch(() => ({ data: [] }))
    ])

    const events: ActivityEvent[] = [
      ...salesAsBuyer.data.map(toSaleBuyerEvent),
      ...salesAsSeller.data.map(toSaleSellerEvent),
      ...bidsAsBidder.data.map(toBidPlacedEvent),
      // Bids returned with `seller` filter could include the user's own bids when bidder==seller; filter those out.
      ...bidsAsSeller.data.filter(b => b.bidder.toLowerCase() !== lower).map(toBidReceivedEvent),
      ...ordersAsOwner.data.map(toOrderCreatedEvent),
      ...ordersAsBuyer.data.filter(isOrderFilled).map(toOrderFilledEvent),
      ...userTrades.data
        // Don't surface cancelled/expired trades the user opened.
        // (status isn't on the Trade type; we'd need extra plumbing to compute it — for v1, include all.)
        .map(toTradeCreatedEvent)
    ]

    const sorted = sortByTimestampDesc(events)
    const deduped = dedupeEvents(sorted)
    const capped = deduped.slice(0, totalCap)

    return { data: capped, total: deduped.length }
  }

  return { getUserActivity }
}
