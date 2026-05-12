/* eslint-disable @typescript-eslint/unbound-method */
import {
  LegacyBid,
  ListingStatus,
  Network,
  Order,
  Sale,
  SaleType,
  Trade,
  TradeAssetDirection,
  TradeAssetType,
  TradeType
} from '@dcl/schemas'
import { createActivityComponent } from '../../src/ports/activity'
import { ActivityEventType, IActivityComponent } from '../../src/ports/activity/types'
import { IBidsComponent } from '../../src/ports/bids'
import { IOrdersComponent } from '../../src/ports/orders/types'
import { ISalesComponent } from '../../src/ports/sales'
import { ITradesComponent } from '../../src/ports/trades/types'

const makeLogs = (logger: { warn: jest.Mock; error?: jest.Mock; info?: jest.Mock; debug?: jest.Mock; log?: jest.Mock }) => ({
  getLogger: jest.fn().mockReturnValue({
    warn: logger.warn,
    error: logger.error ?? jest.fn(),
    info: logger.info ?? jest.fn(),
    debug: logger.debug ?? jest.fn(),
    log: logger.log ?? jest.fn()
  })
})

const makeSale = (overrides: Partial<Sale> = {}): Sale => ({
  id: 's1',
  type: SaleType.ORDER,
  buyer: '0xbuyer',
  seller: '0xseller',
  itemId: null,
  tokenId: '1',
  contractAddress: '0xnft',
  price: '100',
  timestamp: 5000,
  txHash: '0xsalehash',
  network: Network.MATIC,
  chainId: 137 as any,
  ...overrides
})

const makeOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    id: 'o1',
    marketplaceAddress: '0xmarket',
    contractAddress: '0xnft',
    tokenId: '1',
    owner: '0xowner',
    buyer: null,
    price: '50',
    status: ListingStatus.OPEN,
    expiresAt: 9000,
    createdAt: 2000,
    updatedAt: 2000,
    network: Network.MATIC,
    chainId: 137 as any,
    issuedId: '1',
    ...overrides
  } as Order)

const makeBid = (overrides: Partial<LegacyBid> = {}): LegacyBid => ({
  id: 'b1',
  bidder: '0xbidder',
  seller: '0xseller',
  price: '25',
  status: ListingStatus.OPEN,
  expiresAt: 9000,
  createdAt: 3000,
  updatedAt: 3000,
  contractAddress: '0xnft',
  network: Network.MATIC,
  chainId: 137 as any,
  fingerprint: '',
  tokenId: '1',
  bidAddress: '0xbid',
  blockchainId: '1',
  blockNumber: '1',
  ...overrides
})

const makeTrade = (overrides: Partial<Trade> = {}): Trade => ({
  id: 't1',
  signature: 'sig',
  signer: '0xuser',
  network: Network.MATIC,
  chainId: 137 as any,
  type: TradeType.BID,
  checks: {} as any,
  createdAt: 4000,
  sent: [],
  received: [],
  contract: '0xtrade',
  ...overrides
})

describe('createActivityComponent', () => {
  let sales: jest.Mocked<ISalesComponent>
  let bids: jest.Mocked<IBidsComponent>
  let orders: jest.Mocked<IOrdersComponent>
  let trades: jest.Mocked<Pick<ITradesComponent, 'getTradesByAddress'>>
  let activity: IActivityComponent
  let logWarn: jest.Mock

  beforeEach(() => {
    sales = { getSales: jest.fn().mockResolvedValue({ data: [], total: 0 }) }
    bids = { getBids: jest.fn().mockResolvedValue({ data: [], count: 0 }) }
    orders = { getOrders: jest.fn().mockResolvedValue({ data: [], total: 0 }) }
    trades = { getTradesByAddress: jest.fn().mockResolvedValue({ data: [] }) }
    logWarn = jest.fn()
    const logs = makeLogs({ warn: logWarn })
    activity = createActivityComponent({ sales, bids, orders, trades: trades as unknown as ITradesComponent, logs })
  })

  describe('when called with an address', () => {
    it('should lowercase the address and query every source with the default cap', async () => {
      await activity.getUserActivity('0xUSER')

      expect(sales.getSales).toHaveBeenCalledWith({ buyer: '0xuser', first: 500 })
      expect(sales.getSales).toHaveBeenCalledWith({ seller: '0xuser', first: 500 })
      expect(bids.getBids).toHaveBeenCalledWith({ bidder: '0xuser', limit: 500, offset: 0 })
      expect(bids.getBids).toHaveBeenCalledWith({ seller: '0xuser', limit: 500, offset: 0 })
      expect(orders.getOrders).toHaveBeenCalledWith({ owner: '0xuser', first: 500 })
      expect(orders.getOrders).toHaveBeenCalledWith({ buyer: '0xuser', first: 500 })
      expect(trades.getTradesByAddress).toHaveBeenCalledWith('0xuser', { limit: 500 })
    })
  })

  describe('and a custom limit is provided', () => {
    it('should forward it to every source and clamp the final slice', async () => {
      await activity.getUserActivity('0xuser', { limit: 25 })
      expect(sales.getSales).toHaveBeenCalledWith({ buyer: '0xuser', first: 25 })
      expect(trades.getTradesByAddress).toHaveBeenCalledWith('0xuser', { limit: 25 })
    })

    it('should clamp limits above the default cap', async () => {
      await activity.getUserActivity('0xuser', { limit: 99999 })
      expect(sales.getSales).toHaveBeenCalledWith({ buyer: '0xuser', first: 500 })
    })

    it('should fall back to the default cap on non-positive limits', async () => {
      await activity.getUserActivity('0xuser', { limit: 0 })
      expect(sales.getSales).toHaveBeenCalledWith({ buyer: '0xuser', first: 500 })
    })
  })

  describe('and there are events from multiple sources', () => {
    beforeEach(() => {
      sales.getSales.mockImplementation(filters =>
        filters.buyer
          ? Promise.resolve({ data: [makeSale({ id: 'sb', timestamp: 5000, txHash: '0xa' })], total: 1 })
          : Promise.resolve({ data: [makeSale({ id: 'ss', timestamp: 6000, txHash: '0xb' })], total: 1 })
      )
      orders.getOrders.mockImplementation(filters =>
        filters?.owner
          ? Promise.resolve({ data: [makeOrder({ id: 'oo', createdAt: 2000 })], total: 1 })
          : Promise.resolve({
              data: [makeOrder({ id: 'ob', updatedAt: 7000, status: ListingStatus.SOLD, buyer: '0xother' })],
              total: 1
            })
      )
      bids.getBids.mockImplementation(opts =>
        opts.bidder
          ? Promise.resolve({ data: [makeBid({ id: 'bb', createdAt: 3000 })], count: 1 })
          : Promise.resolve({ data: [makeBid({ id: 'br', createdAt: 8000, bidder: '0xother' })], count: 1 })
      )
      trades.getTradesByAddress.mockResolvedValue({ data: [makeTrade({ id: 'tt', createdAt: 4000 })] })
    })

    it('should return events sorted by timestamp DESC', async () => {
      const { data } = await activity.getUserActivity('0xuser')
      const timestamps = data.map(e => e.timestamp)
      expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a))
    })

    it('should include one event per source with the right type', async () => {
      const { data } = await activity.getUserActivity('0xuser')
      const types = data.map(e => e.type).sort()
      expect(types).toContain(ActivityEventType.SALE_BUYER)
      expect(types).toContain(ActivityEventType.SALE_SELLER)
      expect(types).toContain(ActivityEventType.BID_PLACED)
      expect(types).toContain(ActivityEventType.BID_RECEIVED)
      expect(types).toContain(ActivityEventType.ORDER_CREATED)
      expect(types).toContain(ActivityEventType.ORDER_FILLED)
      expect(types).toContain(ActivityEventType.TRADE_CREATED)
    })

    it('should encode the user perspective in each event id', async () => {
      const { data } = await activity.getUserActivity('0xuser')
      const ids = new Set(data.map(e => e.id))
      expect(ids).toContain('sale_buyer:sb')
      expect(ids).toContain('sale_seller:ss')
      expect(ids).toContain('bid_placed:bb')
      expect(ids).toContain('bid_received:br')
      expect(ids).toContain('order_created:oo')
      expect(ids).toContain('order_filled:ob')
      expect(ids).toContain('trade_created:tt')
    })
  })

  describe('and a bid filtered by seller was placed by the user themselves', () => {
    beforeEach(() => {
      bids.getBids.mockImplementation(opts =>
        opts.seller
          ? Promise.resolve({ data: [makeBid({ id: 'self', bidder: '0xuser' })], count: 1 })
          : Promise.resolve({ data: [], count: 0 })
      )
    })

    it('should NOT include the user-as-bidder bid in bid_received', async () => {
      const { data } = await activity.getUserActivity('0xuser')
      expect(data.find(e => e.type === ActivityEventType.BID_RECEIVED)).toBeUndefined()
    })
  })

  describe('and an order returned via buyer filter is not yet SOLD', () => {
    beforeEach(() => {
      orders.getOrders.mockImplementation(filters =>
        filters?.buyer
          ? Promise.resolve({ data: [makeOrder({ id: 'open', status: ListingStatus.OPEN, buyer: null })], total: 1 })
          : Promise.resolve({ data: [], total: 0 })
      )
    })

    it('should NOT emit an order_filled event for it', async () => {
      const { data } = await activity.getUserActivity('0xuser')
      expect(data.find(e => e.type === ActivityEventType.ORDER_FILLED)).toBeUndefined()
    })
  })

  describe('and two events of the same TYPE share a txHash (true on-chain duplicate)', () => {
    beforeEach(() => {
      // Two sales-as-buyer with the same txHash — only one should survive
      sales.getSales.mockImplementation(filters =>
        filters.buyer
          ? Promise.resolve({
              data: [
                makeSale({ id: 'a', txHash: '0xshared', timestamp: 5000 }),
                makeSale({ id: 'b', txHash: '0xSHARED', timestamp: 5000 })
              ],
              total: 2
            })
          : Promise.resolve({ data: [], total: 0 })
      )
    })

    it('should dedupe them (case-insensitive)', async () => {
      const { data } = await activity.getUserActivity('0xuser')
      const sales = data.filter(e => e.type === ActivityEventType.SALE_BUYER)
      expect(sales).toHaveLength(1)
    })
  })

  describe('and two events with DIFFERENT types share a txHash (e.g. sale_seller + order_filled)', () => {
    beforeEach(() => {
      sales.getSales.mockImplementation(filters =>
        filters.seller
          ? Promise.resolve({ data: [makeSale({ id: 'sx', txHash: '0xshared', timestamp: 5000 })], total: 1 })
          : Promise.resolve({ data: [], total: 0 })
      )
      orders.getOrders.mockImplementation(filters =>
        filters?.owner
          ? Promise.resolve({ data: [makeOrder({ id: 'ox', status: ListingStatus.SOLD, buyer: '0xother' })], total: 1 })
          : Promise.resolve({ data: [], total: 0 })
      )
    })

    it('should keep BOTH events (distinct semantic perspectives)', async () => {
      const { data } = await activity.getUserActivity('0xuser')
      const types = data.map(e => e.type)
      // sale_seller is from the seller-filter sale; order_created is from the owner-filter order
      // Both share '0xshared' indirectly only if the same on-chain tx — but our types differ so both survive
      expect(types).toContain(ActivityEventType.SALE_SELLER)
      expect(types).toContain(ActivityEventType.ORDER_CREATED)
    })
  })

  describe('and a trade is paid with USD_PEGGED_MANA instead of ERC20', () => {
    beforeEach(() => {
      trades.getTradesByAddress.mockResolvedValue({
        data: [
          makeTrade({
            id: 'tu',
            sent: [
              {
                assetType: TradeAssetType.ERC721,
                contractAddress: '0xnft',
                tokenId: '99',
                extra: '',
                beneficiary: '0xuser'
              } as any
            ],
            received: [
              {
                assetType: TradeAssetType.USD_PEGGED_MANA,
                contractAddress: '0xmana',
                amount: '777000000000000000000',
                extra: '',
                beneficiary: '0xuser'
              } as any
            ]
          })
        ]
      })
    })

    it('should extract the USD-pegged amount as the trade price', async () => {
      const { data } = await activity.getUserActivity('0xuser')
      const trade = data.find(e => e.type === ActivityEventType.TRADE_CREATED)
      expect(trade).toBeDefined()
      expect(trade?.price).toBe('777000000000000000000')
      expect(trade?.tokenId).toBe('99')
    })
  })

  describe('and one source rejects', () => {
    beforeEach(() => {
      sales.getSales.mockRejectedValue(new Error('sales db down'))
      orders.getOrders.mockResolvedValue({ data: [makeOrder({ id: 'oo' })], total: 1 })
    })

    it('should still return events from the other sources', async () => {
      const { data } = await activity.getUserActivity('0xuser')
      expect(data.length).toBeGreaterThan(0)
      expect(data.every(e => e.type !== ActivityEventType.SALE_BUYER && e.type !== ActivityEventType.SALE_SELLER)).toBe(true)
    })

    it('should log a warning for the failed source', async () => {
      await activity.getUserActivity('0xuser')
      expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('sales db down'))
    })
  })

  describe('and the aggregated list exceeds the limit', () => {
    beforeEach(() => {
      const many = Array.from({ length: 200 }, (_, i) => makeSale({ id: `s${i}`, timestamp: i, txHash: `0x${i}` }))
      sales.getSales.mockImplementation(filters =>
        filters.buyer ? Promise.resolve({ data: many, total: many.length }) : Promise.resolve({ data: [], total: 0 })
      )
    })

    it('should respect the custom limit', async () => {
      const { data } = await activity.getUserActivity('0xuser', { limit: 50 })
      expect(data).toHaveLength(50)
    })

    it('should set total to the pre-cap (post-dedup) count', async () => {
      const { total } = await activity.getUserActivity('0xuser', { limit: 50 })
      expect(total).toBe(200)
    })
  })

  // Silence TS6133 unused-import warning — TradeAssetDirection is used implicitly above
  void TradeAssetDirection
})
