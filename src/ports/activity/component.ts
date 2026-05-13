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

// Every request refetches all 7 sources, sorts and dedupes them. `INTERNAL_FETCH_CAP` is
// how many rows we pull from each source — bounds the worst-case work per request.
// `MAX_PAGE_SIZE` is both the default and the hard cap for the response slice; a client
// that doesn't pass `limit` gets the largest meaningful page (no surprise paging by us).
const INTERNAL_FETCH_CAP = 500
const MAX_PAGE_SIZE = 500

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

  async function getUserActivity(address: string, options: { limit?: number; offset?: number } = {}) {
    const requested = options.limit && options.limit > 0 ? options.limit : MAX_PAGE_SIZE
    const limit = Math.min(requested, MAX_PAGE_SIZE)
    const offset = options.offset && options.offset > 0 ? options.offset : 0
    const per = INTERNAL_FETCH_CAP
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
    const page = deduped.slice(offset, offset + limit)

    return { data: page, total: deduped.length }
  }

  return { getUserActivity }
}
