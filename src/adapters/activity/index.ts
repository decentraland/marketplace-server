import { Bid, ListingStatus, Order, Sale, Trade, TradeAsset, TradeAssetType } from '@dcl/schemas'
import {
  ActivityEvent,
  ActivityEventType,
  BidPlacedEvent,
  BidReceivedEvent,
  OrderCreatedEvent,
  OrderFilledEvent,
  SaleBuyerEvent,
  SaleSellerEvent,
  TradeCreatedEvent
} from '../../ports/activity/types'

const nullToUndefined = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v)

const pickTokenOrItem = (b: Bid): { tokenId?: string; itemId?: string } => {
  if ('tokenId' in b && b.tokenId) return { tokenId: b.tokenId }
  if ('itemId' in b && b.itemId) return { itemId: b.itemId }
  return {}
}

const isPaymentAsset = (a: TradeAsset): a is TradeAsset & { amount: string } =>
  a.assetType === TradeAssetType.ERC20 || a.assetType === TradeAssetType.USD_PEGGED_MANA

function toSaleEvent<T extends ActivityEventType.SALE_BUYER | ActivityEventType.SALE_SELLER>(
  sale: Sale,
  type: T,
  counterparty: string
): T extends ActivityEventType.SALE_BUYER ? SaleBuyerEvent : SaleSellerEvent {
  return {
    id: `${type}:${sale.id}`,
    type,
    timestamp: sale.timestamp,
    network: sale.network,
    txHash: sale.txHash,
    contractAddress: sale.contractAddress,
    tokenId: sale.tokenId,
    itemId: nullToUndefined(sale.itemId),
    price: sale.price,
    counterparty,
    details: { sale }
  } as never
}

export const toSaleBuyerEvent = (sale: Sale): SaleBuyerEvent => toSaleEvent(sale, ActivityEventType.SALE_BUYER, sale.seller)
export const toSaleSellerEvent = (sale: Sale): SaleSellerEvent => toSaleEvent(sale, ActivityEventType.SALE_SELLER, sale.buyer)

function toBidEvent<T extends ActivityEventType.BID_PLACED | ActivityEventType.BID_RECEIVED>(
  bid: Bid,
  type: T,
  counterparty: string
): T extends ActivityEventType.BID_PLACED ? BidPlacedEvent : BidReceivedEvent {
  return {
    id: `${type}:${bid.id}`,
    type,
    timestamp: bid.createdAt,
    network: bid.network,
    contractAddress: bid.contractAddress,
    ...pickTokenOrItem(bid),
    price: bid.price,
    counterparty,
    details: { bid }
  } as never
}

export const toBidPlacedEvent = (bid: Bid): BidPlacedEvent => toBidEvent(bid, ActivityEventType.BID_PLACED, bid.seller)
export const toBidReceivedEvent = (bid: Bid): BidReceivedEvent => toBidEvent(bid, ActivityEventType.BID_RECEIVED, bid.bidder)

export function toOrderCreatedEvent(order: Order): OrderCreatedEvent {
  return {
    id: `${ActivityEventType.ORDER_CREATED}:${order.id}`,
    type: ActivityEventType.ORDER_CREATED,
    timestamp: order.createdAt,
    network: order.network,
    contractAddress: order.contractAddress,
    tokenId: order.tokenId,
    price: order.price,
    details: { order }
  }
}

export function toOrderFilledEvent(order: Order): OrderFilledEvent {
  return {
    id: `${ActivityEventType.ORDER_FILLED}:${order.id}`,
    type: ActivityEventType.ORDER_FILLED,
    timestamp: order.updatedAt,
    network: order.network,
    contractAddress: order.contractAddress,
    tokenId: order.tokenId,
    price: order.price,
    counterparty: order.owner,
    details: { order }
  }
}

export function toTradeCreatedEvent(trade: Trade): TradeCreatedEvent {
  const assets = [...trade.sent, ...trade.received]
  const nonPayment = assets.find(a => !isPaymentAsset(a))
  const payment = assets.find(isPaymentAsset)
  return {
    id: `${ActivityEventType.TRADE_CREATED}:${trade.id}`,
    type: ActivityEventType.TRADE_CREATED,
    timestamp: trade.createdAt,
    network: trade.network,
    contractAddress: nonPayment?.contractAddress,
    tokenId: nonPayment && 'tokenId' in nonPayment ? nonPayment.tokenId : undefined,
    itemId: nonPayment && 'itemId' in nonPayment ? nonPayment.itemId : undefined,
    price: payment?.amount,
    details: { trade }
  }
}

export const isOrderFilled = (order: Order): boolean => order.status === ListingStatus.SOLD && !!order.buyer

export const sortByTimestampDesc = (events: ActivityEvent[]): ActivityEvent[] => [...events].sort((a, b) => b.timestamp - a.timestamp)

// Dedup keeps the first event in sort order (the aggregator orders sources so the canonical
// source wins). Key includes `type` because the same on-chain tx can legitimately emit
// distinct semantic events for the same user — e.g. `sale_seller` AND `order_filled` both
// describe "someone bought your listing" from different model angles, with different
// counterparty fields, so both must survive.
export function dedupeEvents(events: ActivityEvent[]): ActivityEvent[] {
  const seen = new Set<string>()
  const out: ActivityEvent[] = []
  for (const ev of events) {
    const key = ev.txHash
      ? `tx:${ev.txHash.toLowerCase()}:${ev.type}`
      : `${ev.contractAddress ?? '-'}|${ev.tokenId ?? ev.itemId ?? '-'}|${ev.timestamp}|${ev.type}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ev)
  }
  return out
}
