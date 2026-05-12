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
import { isErrorWithMessage } from '../../logic/errors'
import { AppComponents } from '../../types'
import { ActivityEvent, IActivityComponent } from './types'

// Per-source cap matches the total cap on purpose: a power user whose history is dominated
// by one source (e.g. 400 sales, 20 bids, 5 orders) still sees their newest activity instead
// of getting bins truncated to 100 per source. Trade-off: heavier query for the dominated
// source, but bounded by `limit` which the caller can lower if needed.
const DEFAULT_LIMIT = 500

export function createActivityComponent(
  components: Pick<AppComponents, 'sales' | 'bids' | 'orders' | 'trades' | 'logs'>
): IActivityComponent {
  const { sales, bids, orders, trades, logs } = components
  const logger = logs.getLogger('Activity component')

  type SourceFetcher<T> = () => Promise<T>
  const safeFetch = async <T>(label: string, empty: T, fn: SourceFetcher<T>): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      logger.warn(`Activity source "${label}" failed; degrading gracefully. ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
      return empty
    }
  }

  async function getUserActivity(address: string, options: { limit?: number } = {}) {
    const limit = options.limit && options.limit > 0 ? Math.min(options.limit, DEFAULT_LIMIT) : DEFAULT_LIMIT
    const per = limit
    const lower = address.toLowerCase()

    const [salesAsBuyer, salesAsSeller, bidsAsBidder, bidsAsSeller, ordersAsOwner, ordersAsBuyer, userTrades] = await Promise.all([
      safeFetch('sales:buyer', { data: [], total: 0 }, () => sales.getSales({ buyer: lower, first: per })),
      safeFetch('sales:seller', { data: [], total: 0 }, () => sales.getSales({ seller: lower, first: per })),
      safeFetch('bids:bidder', { data: [], count: 0 }, () => bids.getBids({ bidder: lower, limit: per, offset: 0 })),
      safeFetch('bids:seller', { data: [], count: 0 }, () => bids.getBids({ seller: lower, limit: per, offset: 0 })),
      safeFetch('orders:owner', { data: [], total: 0 }, () => orders.getOrders({ owner: lower, first: per })),
      safeFetch('orders:buyer', { data: [], total: 0 }, () => orders.getOrders({ buyer: lower, first: per })),
      safeFetch('trades:address', { data: [] }, () => trades.getTradesByAddress(lower, { limit: per }))
    ])

    const events: ActivityEvent[] = [
      ...salesAsBuyer.data.map(toSaleBuyerEvent),
      ...salesAsSeller.data.map(toSaleSellerEvent),
      ...bidsAsBidder.data.map(toBidPlacedEvent),
      ...bidsAsSeller.data.filter(b => b.bidder.toLowerCase() !== lower).map(toBidReceivedEvent),
      ...ordersAsOwner.data.map(toOrderCreatedEvent),
      ...ordersAsBuyer.data.filter(isOrderFilled).map(toOrderFilledEvent),
      ...userTrades.data.map(toTradeCreatedEvent)
    ]

    const sorted = sortByTimestampDesc(events)
    const deduped = dedupeEvents(sorted)
    const capped = deduped.slice(0, limit)

    return { data: capped, total: deduped.length }
  }

  return { getUserActivity }
}
