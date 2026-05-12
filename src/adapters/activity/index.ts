import { Bid, ListingStatus, Order, Sale, Trade, TradeAssetType } from '@dcl/schemas'
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

function pickTokenOrItem(b: Bid): { tokenId?: string; itemId?: string } {
  if ('tokenId' in b && b.tokenId) return { tokenId: b.tokenId }
  if ('itemId' in b && b.itemId) return { itemId: b.itemId }
  return {}
}

export function toSaleBuyerEvent(sale: Sale): SaleBuyerEvent {
  return {
    id: `sale:${sale.id}`,
    type: ActivityEventType.SALE_BUYER,
    timestamp: sale.timestamp,
    network: sale.network,
    txHash: sale.txHash,
    contractAddress: sale.contractAddress,
    tokenId: sale.tokenId,
    itemId: sale.itemId ?? undefined,
    price: sale.price,
    counterparty: sale.seller,
    details: { sale }
  }
}

export function toSaleSellerEvent(sale: Sale): SaleSellerEvent {
  return {
    id: `sale:${sale.id}`,
    type: ActivityEventType.SALE_SELLER,
    timestamp: sale.timestamp,
    network: sale.network,
    txHash: sale.txHash,
    contractAddress: sale.contractAddress,
    tokenId: sale.tokenId,
    itemId: sale.itemId ?? undefined,
    price: sale.price,
    counterparty: sale.buyer,
    details: { sale }
  }
}

export function toBidPlacedEvent(bid: Bid): BidPlacedEvent {
  return {
    id: `bid:${bid.id}`,
    type: ActivityEventType.BID_PLACED,
    timestamp: bid.createdAt,
    network: bid.network,
    contractAddress: bid.contractAddress,
    ...pickTokenOrItem(bid),
    price: bid.price,
    counterparty: bid.seller,
    details: { bid }
  }
}

export function toBidReceivedEvent(bid: Bid): BidReceivedEvent {
  return {
    id: `bid:${bid.id}`,
    type: ActivityEventType.BID_RECEIVED,
    timestamp: bid.createdAt,
    network: bid.network,
    contractAddress: bid.contractAddress,
    ...pickTokenOrItem(bid),
    price: bid.price,
    counterparty: bid.bidder,
    details: { bid }
  }
}

export function toOrderCreatedEvent(order: Order): OrderCreatedEvent {
  return {
    id: `order:${order.id}`,
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
    id: `order-filled:${order.id}`,
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
  const firstNonERC20 = [...trade.sent, ...trade.received].find(a => a.assetType !== TradeAssetType.ERC20)
  const erc20 = [...trade.sent, ...trade.received].find(a => a.assetType === TradeAssetType.ERC20)
  return {
    id: `trade:${trade.id}`,
    type: ActivityEventType.TRADE_CREATED,
    timestamp: trade.createdAt,
    network: trade.network,
    contractAddress: firstNonERC20?.contractAddress,
    tokenId: firstNonERC20 && 'tokenId' in firstNonERC20 ? firstNonERC20.tokenId : undefined,
    itemId: firstNonERC20 && 'itemId' in firstNonERC20 ? firstNonERC20.itemId : undefined,
    price: erc20 && 'amount' in erc20 ? erc20.amount : undefined,
    details: { trade }
  }
}

export function isOrderFilled(order: Order): boolean {
  return order.status === ListingStatus.SOLD && !!order.buyer
}

export function sortByTimestampDesc(events: ActivityEvent[]): ActivityEvent[] {
  return [...events].sort((a, b) => b.timestamp - a.timestamp)
}

// Drops server-side duplicates: when the same on-chain event appears in two sources
// (e.g. an order filled via the new trades pipeline shows up both as a sale and a trade,
// or `orders.getOrders({ buyer })` returns trade-orders with an empty buyer).
// Keep the first occurrence in the sorted list — sources are intentionally added in
// the aggregator in the order we want to win (sales/bids/orders first, trades last).
export function dedupeEvents(events: ActivityEvent[]): ActivityEvent[] {
  const seen = new Set<string>()
  const out: ActivityEvent[] = []
  for (const ev of events) {
    const key = ev.txHash
      ? `tx:${ev.txHash.toLowerCase()}`
      : `${ev.contractAddress ?? '-'}|${ev.tokenId ?? ev.itemId ?? '-'}|${ev.timestamp}|${ev.type}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ev)
  }
  return out
}
