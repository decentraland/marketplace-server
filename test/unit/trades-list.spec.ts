import { ILoggerComponent } from '@well-known-components/interfaces'
import { SQLStatement } from 'sql-template-strings'
import { getTradesHandler } from '../../src/controllers/handlers/trades-handler'
import { IPgComponent } from '../../src/ports/db/types'
import { IEventPublisherComponent } from '../../src/ports/events/types'
import { IShopNotifierComponent } from '../../src/ports/shop-notifier/types'
import { DBTrade, ITradesComponent, TradeListFilters, createTradesComponent } from '../../src/ports/trades'
import { getTradeListCountQuery, getTradeListQuery } from '../../src/ports/trades/queries'
import { HTTPResponse, HandlerContextWithPath, StatusCode } from '../../src/types'
import { createTestLogsComponent } from '../components'

const SIGNER = '0x1111111111111111111111111111111111111111'
const CHECKSUMMED_MARKETPLACE = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01'
const OTHER_MARKETPLACE = '0x2222222222222222222222222222222222222222'

describe('when building the trade list query', () => {
  let filters: TradeListFilters
  let query: SQLStatement

  describe('and no filters are given', () => {
    beforeEach(() => {
      filters = {}
      query = getTradeListQuery(filters)
    })

    it('should select every trade ordered by creation date and id without a where, limit or offset', () => {
      expect(query.text.replace(/\s+/g, ' ').trim()).toEqual('SELECT t.* FROM marketplace.trades AS t ORDER BY t.created_at DESC, t.id ASC')
    })

    it('should not bind any values', () => {
      expect(query.values).toEqual([])
    })
  })

  describe('and a signer is given', () => {
    beforeEach(() => {
      filters = { signer: SIGNER.toUpperCase().replace('0X', '0x') }
      query = getTradeListQuery(filters)
    })

    it('should compare the signer column directly', () => {
      expect(query.text).toContain('WHERE t.signer = $1')
    })

    it('should bind the lowercased signer', () => {
      expect(query.values).toEqual([SIGNER])
    })
  })

  describe('and marketplace addresses are given', () => {
    beforeEach(() => {
      filters = { marketplaceAddresses: [CHECKSUMMED_MARKETPLACE, OTHER_MARKETPLACE] }
      query = getTradeListQuery(filters)
    })

    it('should compare the lowercased marketplace contract column against any of the values', () => {
      expect(query.text).toContain('WHERE LOWER(t.contract) = ANY($1)')
    })

    it('should bind the lowercased marketplace addresses', () => {
      expect(query.values).toEqual([[CHECKSUMMED_MARKETPLACE.toLowerCase(), OTHER_MARKETPLACE]])
    })
  })

  describe('and a signer and marketplace addresses are given', () => {
    beforeEach(() => {
      filters = { signer: SIGNER, marketplaceAddresses: [OTHER_MARKETPLACE] }
      query = getTradeListQuery(filters)
    })

    it('should combine both conditions with AND', () => {
      expect(query.text).toContain('WHERE t.signer = $1 AND LOWER(t.contract) = ANY($2)')
    })
  })

  describe('and first and skip are given', () => {
    beforeEach(() => {
      filters = { first: 10, skip: 20 }
      query = getTradeListQuery(filters)
    })

    it('should limit and offset after ordering', () => {
      expect(query.text).toContain('ORDER BY t.created_at DESC, t.id ASC LIMIT $1 OFFSET $2')
    })

    it('should bind first and skip', () => {
      expect(query.values).toEqual([10, 20])
    })
  })

  describe('and only skip is given', () => {
    beforeEach(() => {
      filters = { skip: 20 }
      query = getTradeListQuery(filters)
    })

    it('should offset after ordering without a limit', () => {
      expect(query.text.replace(/\s+/g, ' ').trim()).toEqual(
        'SELECT t.* FROM marketplace.trades AS t ORDER BY t.created_at DESC, t.id ASC OFFSET $1'
      )
    })

    it('should bind skip', () => {
      expect(query.values).toEqual([20])
    })
  })

  describe('and first is above the maximum', () => {
    beforeEach(() => {
      filters = { first: 5000 }
      query = getTradeListQuery(filters)
    })

    it('should cap the limit at 1000', () => {
      expect(query.values).toEqual([1000])
    })
  })

  describe('and first is zero', () => {
    beforeEach(() => {
      filters = { first: 0 }
      query = getTradeListQuery(filters)
    })

    it('should apply a zero limit', () => {
      expect(query.values).toEqual([0])
    })
  })
})

describe('when building the trade list count query', () => {
  let query: SQLStatement

  beforeEach(() => {
    query = getTradeListCountQuery({ signer: SIGNER, marketplaceAddresses: [OTHER_MARKETPLACE], first: 10, skip: 5 })
  })

  it('should count the filtered trades without pagination', () => {
    expect(query.text.replace(/\s+/g, ' ').trim()).toEqual(
      'SELECT COUNT(*)::int AS count FROM marketplace.trades AS t WHERE t.signer = $1 AND LOWER(t.contract) = ANY($2)'
    )
  })
})

describe('when listing trades', () => {
  let tradesComponent: ITradesComponent
  let queryMock: jest.Mock
  let rows: DBTrade[]
  let result: { data: DBTrade[]; count: number }

  beforeEach(() => {
    rows = [{ id: '1' } as DBTrade, { id: '2' } as DBTrade]
    queryMock = jest.fn()
    const pg: IPgComponent = {
      getPool: jest.fn(),
      withTransaction: jest.fn(),
      withAsyncContextTransaction: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      streamQuery: jest.fn(),
      query: queryMock
    }
    const eventPublisher: IEventPublisherComponent = { publishMessage: jest.fn() }
    const shopNotifier = { notifyItemOnSale: jest.fn() } as unknown as IShopNotifierComponent
    tradesComponent = createTradesComponent({
      dappsDatabase: pg,
      eventPublisher,
      logs: createTestLogsComponent(),
      shopNotifier
    })
  })

  describe('and no pagination is given', () => {
    beforeEach(async () => {
      queryMock.mockResolvedValueOnce({ rows, rowCount: rows.length })
      result = await tradesComponent.getTrades({ signer: SIGNER })
    })

    it('should return the rows and their number as the count', () => {
      expect(result).toEqual({ data: rows, count: 2 })
    })

    it('should run a single query', () => {
      expect(queryMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and pagination is given', () => {
    beforeEach(async () => {
      queryMock.mockResolvedValueOnce({ rows, rowCount: rows.length }).mockResolvedValueOnce({ rows: [{ count: 42 }], rowCount: 1 })
      result = await tradesComponent.getTrades({ signer: SIGNER, first: 2, skip: 4 })
    })

    it('should return the page and the total count of matching trades', () => {
      expect(result).toEqual({ data: rows, count: 42 })
    })
  })

  describe('and only skip is given', () => {
    beforeEach(async () => {
      queryMock.mockResolvedValueOnce({ rows, rowCount: rows.length }).mockResolvedValueOnce({ rows: [{ count: 6 }], rowCount: 1 })
      result = await tradesComponent.getTrades({ skip: 4 })
    })

    it('should return the remaining trades and the total count of matching trades', () => {
      expect(result).toEqual({ data: rows, count: 6 })
    })

    it('should run the list and the count queries', () => {
      expect(queryMock).toHaveBeenCalledTimes(2)
    })
  })
})

describe('when handling the listing of trades', () => {
  let context: Pick<HandlerContextWithPath<'trades' | 'logs', '/v1/trades'>, 'components' | 'url'>
  let getTradesMock: jest.Mock
  let errorLogMock: jest.Mock
  let logs: ILoggerComponent
  let response: HTTPResponse<{ data: DBTrade[]; count: number }>
  let query: string

  beforeEach(() => {
    getTradesMock = jest.fn()
    errorLogMock = jest.fn()
    logs = createTestLogsComponent({
      getLogger: jest.fn().mockReturnValue({ error: errorLogMock, warn: jest.fn(), info: jest.fn(), debug: jest.fn(), log: jest.fn() })
    })
  })

  async function handle(): Promise<HTTPResponse<{ data: DBTrade[]; count: number }>> {
    context = {
      url: new URL(`http://localhost/v1/trades${query}`),
      components: {
        logs,
        trades: {
          recreateMaterializedView: jest.fn(),
          flushMaterializedViewIfDirty: jest.fn(),
          getTrades: getTradesMock,
          getTradesByAddress: jest.fn(),
          addTrade: jest.fn(),
          getTrade: jest.fn(),
          getTradeAcceptedEvent: jest.fn()
        }
      }
    }
    return getTradesHandler(context)
  }

  describe('and no query parameters are given', () => {
    beforeEach(async () => {
      query = ''
      getTradesMock.mockResolvedValueOnce({ data: [{ id: '1' }], count: 1 })
      response = await handle()
    })

    it('should list the trades without filters', () => {
      expect(getTradesMock).toHaveBeenCalledWith({})
    })

    it('should respond with a 200 and the trades with their count', () => {
      expect(response).toEqual({ status: StatusCode.OK, body: { ok: true, data: { data: [{ id: '1' }], count: 1 } } })
    })
  })

  describe('and every parameter is given', () => {
    beforeEach(async () => {
      query = `?signer=${SIGNER.toUpperCase().replace(
        '0X',
        '0x'
      )}&marketplaceAddress=${CHECKSUMMED_MARKETPLACE}&marketplaceAddress=${OTHER_MARKETPLACE}&first=10&skip=5`
      getTradesMock.mockResolvedValueOnce({ data: [], count: 0 })
      response = await handle()
    })

    it('should list the trades with the lowercased filters and the pagination', () => {
      expect(getTradesMock).toHaveBeenCalledWith({
        signer: SIGNER,
        marketplaceAddresses: [CHECKSUMMED_MARKETPLACE.toLowerCase(), OTHER_MARKETPLACE],
        first: 10,
        skip: 5
      })
    })
  })

  describe('and only skip is given', () => {
    beforeEach(async () => {
      query = '?skip=5'
      getTradesMock.mockResolvedValueOnce({ data: [], count: 5 })
      response = await handle()
    })

    it('should list the trades skipping the given number without a limit', () => {
      expect(getTradesMock).toHaveBeenCalledWith({ skip: 5 })
    })
  })

  describe.each([
    ['an invalid signer', '?signer=0x123'],
    ['an empty signer', '?signer='],
    ['an invalid marketplace address', `?marketplaceAddress=${OTHER_MARKETPLACE}&marketplaceAddress=not-an-address`],
    ['a negative first', '?first=-1'],
    ['a non integer first', '?first=1.5'],
    ['a partially numeric first', '?first=10abc'],
    ['a non numeric skip', '?skip=abc'],
    ['more than 100 marketplace addresses', `?${Array.from({ length: 101 }, () => `marketplaceAddress=${OTHER_MARKETPLACE}`).join('&')}`]
  ])('and %s is given', (_description, invalidQuery) => {
    beforeEach(async () => {
      query = invalidQuery
      response = await handle()
    })

    it('should respond with a 400 and the invalid parameter', () => {
      expect(response).toEqual({
        status: StatusCode.BAD_REQUEST,
        body: { ok: false, message: expect.stringContaining('parameter is invalid') }
      })
    })

    it('should not list the trades', () => {
      expect(getTradesMock).not.toHaveBeenCalled()
    })
  })

  describe('and listing the trades fails', () => {
    beforeEach(async () => {
      query = ''
      getTradesMock.mockRejectedValueOnce(new Error('Database is down'))
      response = await handle()
    })

    it('should respond with a 500 and a generic message', () => {
      expect(response).toEqual({ status: StatusCode.ERROR, body: { ok: false, message: 'Could not fetch the trades' } })
    })

    it('should log the error', () => {
      expect(errorLogMock).toHaveBeenCalledWith('Could not fetch the trades: Database is down')
    })
  })
})
