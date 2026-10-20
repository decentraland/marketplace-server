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
  TradeCreatedEvent,
  TransferReceivedEvent,
  TransferSentEvent
} from '../../ports/activity/types'
import { Transfer } from '../../ports/transfers/types'

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
  // `as never` is the standard TS escape hatch for conditional return types: the
  // narrowing TS does on the call site (returns SaleBuyerEvent when T=SALE_BUYER) can't be
  // proven from inside the function body. The shape is identical for both branches.
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
  // See `toSaleEvent` for the rationale on `as never` with a conditional return type.
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

function toTransferEvent<T extends ActivityEventType.TRANSFER_SENT | ActivityEventType.TRANSFER_RECEIVED>(
  transfer: Transfer,
  type: T,
  counterparty: string
): T extends ActivityEventType.TRANSFER_SENT ? TransferSentEvent : TransferReceivedEvent {
  // See `toSaleEvent` for the rationale on `as never` with a conditional return type.
  return {
    id: `${type}:${transfer.id}`,
    type,
    timestamp: transfer.timestamp,
    network: transfer.network,
    txHash: transfer.txHash,
    contractAddress: transfer.contractAddress,
    tokenId: transfer.tokenId,
    itemId: nullToUndefined(transfer.itemId),
    counterparty,
    details: { transfer }
  } as never
}

export const toTransferSentEvent = (transfer: Transfer): TransferSentEvent =>
  toTransferEvent(transfer, ActivityEventType.TRANSFER_SENT, transfer.to)
export const toTransferReceivedEvent = (transfer: Transfer): TransferReceivedEvent =>
  toTransferEvent(transfer, ActivityEventType.TRANSFER_RECEIVED, transfer.from)

export const isOrderFilled = (order: Order): boolean => order.status === ListingStatus.SOLD && !!order.buyer

export const sortByTimestampDesc = (events: ActivityEvent[]): ActivityEvent[] => [...events].sort((a, b) => b.timestamp - a.timestamp)

// Dedup keeps the first event in sort order (the aggregator orders sources so the canonical
// source wins). Key includes `type` because the same on-chain tx can legitimately emit
// distinct semantic events for the same user — e.g. `sale_seller` AND `order_filled` both
// describe "someone bought your listing" from different model angles, with different
// counterparty fields, so both must survive.
const isTransfer = (ev: ActivityEvent): boolean =>
  ev.type === ActivityEventType.TRANSFER_SENT || ev.type === ActivityEventType.TRANSFER_RECEIVED

function eventKey(ev: ActivityEvent): string {
  if (isTransfer(ev)) return `id:${ev.id}`
  if (ev.txHash) return `tx:${ev.txHash.toLowerCase()}:${ev.type}`
  return `${ev.contractAddress ?? '-'}|${ev.tokenId ?? ev.itemId ?? '-'}|${ev.timestamp}|${ev.type}`
}

export function dedupeEvents(events: ActivityEvent[]): ActivityEvent[] {
  const seen = new Set<string>()
  const out: ActivityEvent[] = []
  for (const ev of events) {
    // One transaction can move several NFTs, and each move is its own transfer, so transfers are keyed by id.
    const key = eventKey(ev)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ev)
  }
  return out
}
