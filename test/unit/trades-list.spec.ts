import { ILoggerComponent } from '@well-known-components/interfaces'
import { SQLStatement } from 'sql-template-strings'
import { ListingStatus, Network, TradeAssetDirection, TradeAssetType, TradeType } from '@dcl/schemas'
import { getTradeListParams, getTradesV2Handler } from '../../src/controllers/handlers/trades-handler'
import { PaginatedResponse } from '../../src/logic/http'
import { IPgComponent } from '../../src/ports/db/types'
import { IEventPublisherComponent } from '../../src/ports/events/types'
import { IShopNotifierComponent } from '../../src/ports/shop-notifier/types'
import {
  DBTradeAssetWithValue,
  DBTradeWithStatus,
  ITradesComponent,
  TradeListFilters,
  TradeWithStatus,
  createTradesComponent
} from '../../src/ports/trades'
import { getTradeAssetsWithValuesByTradeIdsQuery, getTradeListCountQuery, getTradeListQuery } from '../../src/ports/trades/queries'
import { HTTPResponse, HandlerContextWithPath, StatusCode } from '../../src/types'
import { createTestLogsComponent } from '../components'

const SIGNER = '0x1111111111111111111111111111111111111111'
const CHECKSUMMED_SIGNER = '0xAAAA111111111111111111111111111111111111'
const CHECKSUMMED_MARKETPLACE = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01'
const OTHER_MARKETPLACE = '0x2222222222222222222222222222222222222222'

const normalize = (query: SQLStatement): string => query.text.replace(/\s+/g, ' ').trim()

describe('when parsing the trade list parameters', () => {
  let params: URLSearchParams
  let result: TradeListFilters

  describe('and only the signer is given', () => {
    beforeEach(() => {
      params = new URLSearchParams(`signer=${SIGNER}`)
      result = getTradeListParams(params)
    })

    it("should default to the first page of 100 of the signer's trades", () => {
      expect(result).toEqual({ signer: SIGNER, limit: 100, offset: 0 })
    })
  })

  describe('and no signer is given', () => {
    beforeEach(() => {
      params = new URLSearchParams('status=open')
    })

    it('should throw a missing parameter error naming the signer', () => {
      expect(() => getTradeListParams(params)).toThrow('The signer parameter is required')
    })
  })

  describe('and every parameter is given', () => {
    beforeEach(() => {
      params = new URLSearchParams(
        `signer=${CHECKSUMMED_SIGNER}&marketplace_address=${CHECKSUMMED_MARKETPLACE}&marketplace_address=${OTHER_MARKETPLACE}` +
          '&status=open&status=sold&limit=10&offset=20'
      )
      result = getTradeListParams(params)
    })

    it('should return the lowercased filters, the statuses and the pagination', () => {
      expect(result).toEqual({
        signer: CHECKSUMMED_SIGNER.toLowerCase(),
        marketplaceAddresses: [CHECKSUMMED_MARKETPLACE.toLowerCase(), OTHER_MARKETPLACE],
        statuses: [ListingStatus.OPEN, ListingStatus.SOLD],
        limit: 10,
        offset: 20
      })
    })
  })

  describe('and a status is repeated', () => {
    beforeEach(() => {
      params = new URLSearchParams(`signer=${SIGNER}&status=cancelled&status=cancelled`)
      result = getTradeListParams(params)
    })

    it('should keep the status once', () => {
      expect(result.statuses).toEqual([ListingStatus.CANCELLED])
    })
  })

  describe('and the limit is above the maximum', () => {
    beforeEach(() => {
      params = new URLSearchParams(`signer=${SIGNER}&limit=500`)
      result = getTradeListParams(params)
    })

    it('should cap the limit at 100', () => {
      expect(result.limit).toBe(100)
    })
  })

  describe('and a page is given instead of an offset', () => {
    beforeEach(() => {
      params = new URLSearchParams(`signer=${SIGNER}&limit=10&page=3`)
      result = getTradeListParams(params)
    })

    it('should derive the offset from the zero-based page', () => {
      expect(result).toEqual({ signer: SIGNER, limit: 10, offset: 30 })
    })
  })

  describe('and the camelCase marketplace address name is given', () => {
    beforeEach(() => {
      params = new URLSearchParams(`signer=${SIGNER}&marketplaceAddress=${OTHER_MARKETPLACE}`)
      result = getTradeListParams(params)
    })

    it('should not filter by marketplace address', () => {
      expect(result.marketplaceAddresses).toBeUndefined()
    })
  })

  describe.each([
    ['an invalid signer', 'signer=0x123', 'The value of the signer parameter is invalid: 0x123'],
    ['an empty signer', 'signer=', 'The value of the signer parameter is invalid: '],
    [
      'an invalid marketplace address',
      `marketplace_address=${OTHER_MARKETPLACE}&marketplace_address=not-an-address`,
      'The value of the marketplace_address parameter is invalid: not-an-address'
    ],
    [
      'more than 100 marketplace addresses',
      Array.from({ length: 101 }, () => `marketplace_address=${OTHER_MARKETPLACE}`).join('&'),
      'The value of the marketplace_address parameter is invalid: more than 100 values'
    ],
    ['an unknown status', 'status=open&status=expired', 'The value of the status parameter is invalid: expired'],
    ['an uppercase status', 'status=OPEN', 'The value of the status parameter is invalid: OPEN'],
    ['a zero limit', 'limit=0', 'The value of the limit parameter is invalid: 0'],
    ['a negative limit', 'limit=-1', 'The value of the limit parameter is invalid: -1'],
    ['a partially numeric limit', 'limit=10abc', 'The value of the limit parameter is invalid: 10abc'],
    ['a fractional offset', 'offset=1.5', 'The value of the offset parameter is invalid: 1.5'],
    ['a negative offset', 'offset=-10', 'The value of the offset parameter is invalid: -10'],
    ['a non numeric page', 'page=abc', 'The value of the page parameter is invalid: abc']
  ])('and %s is given', (_description, query, message) => {
    beforeEach(() => {
      params = new URLSearchParams(query.startsWith('signer=') ? query : `signer=${SIGNER}&${query}`)
    })

    it('should throw an invalid parameter error naming the parameter and the value', () => {
      expect(() => getTradeListParams(params)).toThrow(message)
    })
  })
})

describe('when building the trade list query', () => {
  let filters: TradeListFilters
  let query: SQLStatement

  describe('and only a signer is given', () => {
    beforeEach(() => {
      filters = { signer: SIGNER, limit: 100, offset: 0 }
      query = getTradeListQuery(filters)
    })

    it("should page the signer's trades ordered by creation date and id in a subquery without joins", () => {
      expect(normalize(query)).toContain(
        '(SELECT t.* FROM marketplace.trades AS t WHERE t.signer = $1 ORDER BY t.created_at DESC, t.id ASC LIMIT $2 OFFSET $3) AS t LEFT JOIN'
      )
    })

    it('should project the status of the paged trades from the status joins', () => {
      expect(normalize(query)).toMatch(
        /^SELECT t\.\*, CASE .* END AS status FROM \(SELECT t\.\* .*\) AS t LEFT JOIN squid_trades\.signature_index .* LEFT JOIN LATERAL .* ORDER BY t\.created_at DESC, t\.id ASC$/
      )
    })

    it('should bind the signer, the limit and the offset', () => {
      expect(query.values).toEqual([SIGNER, 100, 0])
    })
  })

  describe('and a signer and marketplace addresses are given', () => {
    beforeEach(() => {
      filters = { signer: SIGNER, marketplaceAddresses: [CHECKSUMMED_MARKETPLACE, OTHER_MARKETPLACE], limit: 10, offset: 20 }
      query = getTradeListQuery(filters)
    })

    it('should compare the signer directly and the lowercased contract against any of the addresses', () => {
      expect(normalize(query)).toContain('WHERE t.signer = $1 AND t.contract = ANY($2) ORDER BY')
    })

    it('should bind the lowercased filters before the limit and the offset', () => {
      expect(query.values).toEqual([SIGNER, [CHECKSUMMED_MARKETPLACE.toLowerCase(), OTHER_MARKETPLACE], 10, 20])
    })
  })

  describe('and statuses are given', () => {
    beforeEach(() => {
      filters = { signer: SIGNER, statuses: [ListingStatus.OPEN, ListingStatus.CANCELLED], limit: 10, offset: 0 }
      query = getTradeListQuery(filters)
    })

    it('should filter the paged trades by their computed status', () => {
      expect(normalize(query)).toMatch(
        /\(SELECT t\.\* FROM marketplace\.trades AS t LEFT JOIN .* LEFT JOIN LATERAL .* WHERE t\.signer = \$1 AND \(\s?CASE .* END\) = ANY\(\$2\) ORDER BY t\.created_at DESC, t\.id ASC LIMIT \$3 OFFSET \$4\) AS t/
      )
    })

    it('should bind the signer and the statuses', () => {
      expect(query.values).toEqual([SIGNER, [ListingStatus.OPEN, ListingStatus.CANCELLED], 10, 0])
    })

    it('should not skip the expired trades', () => {
      expect(normalize(query)).not.toContain('t.expires_at >=')
    })
  })

  describe('and only the open and sold statuses are given', () => {
    beforeEach(() => {
      filters = { signer: SIGNER, statuses: [ListingStatus.OPEN, ListingStatus.SOLD], limit: 10, offset: 0 }
      query = getTradeListQuery(filters)
    })

    it('should skip the expired trades before computing the status of the paged trades', () => {
      expect(normalize(query)).toMatch(
        /\(SELECT t\.\* FROM marketplace\.trades AS t LEFT JOIN .* WHERE t\.signer = \$1 AND t\.expires_at >= now\(\)::timestamptz\(3\) AND \(\s?CASE .* END\) = ANY\(\$2\) ORDER BY/
      )
    })
  })
})

describe('when building the trade list count query', () => {
  let query: SQLStatement

  describe('and no status is given', () => {
    beforeEach(() => {
      query = getTradeListCountQuery({ signer: SIGNER, marketplaceAddresses: [OTHER_MARKETPLACE] })
    })

    it('should count the filtered trades without computing their status', () => {
      expect(normalize(query)).toEqual(
        'SELECT COUNT(*)::int AS count FROM marketplace.trades AS t WHERE t.signer = $1 AND t.contract = ANY($2)'
      )
    })
  })

  describe('and the sold status is given', () => {
    beforeEach(() => {
      query = getTradeListCountQuery({ signer: SIGNER, statuses: [ListingStatus.SOLD] })
    })

    it('should count the unexpired trades whose computed status matches', () => {
      expect(normalize(query)).toMatch(
        /^SELECT COUNT\(\*\)::int AS count FROM marketplace\.trades AS t LEFT JOIN .* LEFT JOIN LATERAL .* WHERE t\.signer = \$1 AND t\.expires_at >= now\(\)::timestamptz\(3\) AND \(\s?CASE .* END\) = ANY\(\$2\)$/
      )
    })
  })

  describe('and the cancelled status is given', () => {
    beforeEach(() => {
      query = getTradeListCountQuery({ signer: SIGNER, statuses: [ListingStatus.CANCELLED] })
    })

    it('should count the trades whose computed status matches, expired or not', () => {
      expect(normalize(query)).toMatch(
        /^SELECT COUNT\(\*\)::int AS count FROM marketplace\.trades AS t LEFT JOIN .* LEFT JOIN LATERAL .* WHERE t\.signer = \$1 AND \(\s?CASE .* END\) = ANY\(\$2\)$/
      )
    })
  })
})

describe('when building the trade assets query', () => {
  let query: SQLStatement

  beforeEach(() => {
    query = getTradeAssetsWithValuesByTradeIdsQuery(['trade-1', 'trade-2'])
  })

  it('should select the assets of the given trades only', () => {
    expect(normalize(query)).toContain('WHERE ta.trade_id = ANY($1)')
  })

  it('should bind the trade ids', () => {
    expect(query.values).toEqual([['trade-1', 'trade-2']])
  })
})

describe('when listing a page of trades', () => {
  let tradesComponent: ITradesComponent
  let queryMock: jest.Mock
  let filters: TradeListFilters
  let result: { data: TradeWithStatus[]; count: number }

  beforeEach(() => {
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
    const shopNotifier: IShopNotifierComponent = { notifyItemOnSale: jest.fn() }
    tradesComponent = createTradesComponent({ dappsDatabase: pg, eventPublisher, logs: createTestLogsComponent(), shopNotifier })
    filters = { signer: SIGNER, limit: 2, offset: 0 }
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('and the page has trades', () => {
    let tradeRows: DBTradeWithStatus[]
    let assetRows: DBTradeAssetWithValue[]
    let createdAt: Date

    beforeEach(async () => {
      createdAt = new Date('2026-01-01T00:00:00.000Z')
      const checks = {
        uses: 1,
        expiration: 1,
        effective: 0,
        salt: '0x',
        contractSignatureIndex: 0,
        signerSignatureIndex: 0,
        allowedRoot: '0x',
        externalChecks: []
      }
      const baseTrade = {
        chain_id: 1,
        checks,
        created_at: createdAt,
        effective_since: createdAt,
        expires_at: createdAt,
        network: Network.ETHEREUM,
        signature: '0xsignature',
        signer: SIGNER,
        type: TradeType.PUBLIC_NFT_ORDER,
        contract: OTHER_MARKETPLACE
      }
      tradeRows = [
        { ...baseTrade, id: 'trade-1', status: ListingStatus.OPEN },
        { ...baseTrade, id: 'trade-2', status: ListingStatus.CANCELLED }
      ]
      const baseAsset = { created_at: createdAt, extra: '0x', contract_address: '0xcollection' }
      assetRows = [
        {
          ...baseAsset,
          id: 'a1',
          trade_id: 'trade-1',
          direction: TradeAssetDirection.SENT,
          asset_type: TradeAssetType.ERC721,
          token_id: '7'
        },
        {
          ...baseAsset,
          id: 'a2',
          trade_id: 'trade-1',
          direction: TradeAssetDirection.RECEIVED,
          asset_type: TradeAssetType.ERC20,
          amount: '100',
          beneficiary: SIGNER
        }
      ]
      queryMock
        .mockResolvedValueOnce({ rows: tradeRows, rowCount: 2 })
        .mockResolvedValueOnce({ rows: [{ count: 5 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: assetRows, rowCount: 2 })
      result = await tradesComponent.listTrades(filters)
    })

    it('should map each trade with its own assets and status, keeping the page order', () => {
      expect(result).toEqual({
        data: [
          {
            id: 'trade-1',
            signer: SIGNER,
            signature: '0xsignature',
            type: TradeType.PUBLIC_NFT_ORDER,
            network: Network.ETHEREUM,
            chainId: 1,
            checks: tradeRows[0].checks,
            createdAt: createdAt.getTime(),
            sent: [{ assetType: TradeAssetType.ERC721, contractAddress: '0xcollection', extra: '0x', tokenId: '7' }],
            received: [
              { assetType: TradeAssetType.ERC20, contractAddress: '0xcollection', extra: '0x', amount: '100', beneficiary: SIGNER }
            ],
            contract: OTHER_MARKETPLACE,
            status: ListingStatus.OPEN
          },
          expect.objectContaining({ id: 'trade-2', sent: [], received: [], status: ListingStatus.CANCELLED })
        ],
        count: 5
      })
    })

    it('should load the assets of the paged trades only', () => {
      expect(queryMock).toHaveBeenNthCalledWith(3, expect.objectContaining({ values: [['trade-1', 'trade-2']] }))
    })
  })

  describe('and the page is empty', () => {
    beforeEach(async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({ rows: [{ count: 3 }], rowCount: 1 })
      result = await tradesComponent.listTrades({ ...filters, offset: 10 })
    })

    it('should return no trades and the total of matching trades', () => {
      expect(result).toEqual({ data: [], count: 3 })
    })

    it('should not query the assets', () => {
      expect(queryMock).toHaveBeenCalledTimes(2)
    })
  })
})

describe('when handling the v2 listing of trades', () => {
  let listTradesMock: jest.Mock
  let errorLogMock: jest.Mock
  let logs: ILoggerComponent
  let query: string
  let response: HTTPResponse<PaginatedResponse<TradeWithStatus>>

  beforeEach(() => {
    listTradesMock = jest.fn()
    errorLogMock = jest.fn()
    logs = createTestLogsComponent({
      getLogger: jest.fn().mockReturnValue({ error: errorLogMock, warn: jest.fn(), info: jest.fn(), debug: jest.fn(), log: jest.fn() })
    })
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  async function handle(): Promise<HTTPResponse<PaginatedResponse<TradeWithStatus>>> {
    const context: Pick<HandlerContextWithPath<'trades' | 'logs', '/v2/trades'>, 'components' | 'url'> = {
      url: new URL(`http://localhost/v2/trades${query}`),
      components: {
        logs,
        trades: {
          recreateMaterializedView: jest.fn(),
          flushMaterializedViewIfDirty: jest.fn(),
          getTrades: jest.fn(),
          listTrades: listTradesMock,
          getTradesByAddress: jest.fn(),
          addTrade: jest.fn(),
          getTrade: jest.fn(),
          getTradeAcceptedEvent: jest.fn()
        }
      }
    }
    return getTradesV2Handler(context)
  }

  describe('and the parameters are valid', () => {
    beforeEach(async () => {
      query = `?signer=${SIGNER}&status=open&limit=10&offset=20`
      listTradesMock.mockResolvedValueOnce({ data: [{ id: 'trade-1' }], count: 35 })
      response = await handle()
    })

    it('should list the trades with the parsed filters and pagination', () => {
      expect(listTradesMock).toHaveBeenCalledWith({ signer: SIGNER, statuses: [ListingStatus.OPEN], limit: 10, offset: 20 })
    })

    it('should respond with a 200 and the paginated envelope', () => {
      expect(response).toEqual({
        status: StatusCode.OK,
        body: { ok: true, data: { results: [{ id: 'trade-1' }], total: 35, page: 2, pages: 4, limit: 10 } }
      })
    })
  })

  describe('and no trade matches', () => {
    beforeEach(async () => {
      query = `?signer=${SIGNER}`
      listTradesMock.mockResolvedValueOnce({ data: [], count: 0 })
      response = await handle()
    })

    it('should respond with an empty first page and no pages', () => {
      expect(response).toEqual({
        status: StatusCode.OK,
        body: { ok: true, data: { results: [], total: 0, page: 0, pages: 0, limit: 100 } }
      })
    })
  })

  describe('and the signer is missing', () => {
    beforeEach(async () => {
      query = '?status=open'
      response = await handle()
    })

    it('should respond with a 400 and the missing parameter', () => {
      expect(response).toEqual({
        status: StatusCode.BAD_REQUEST,
        body: { ok: false, message: 'The signer parameter is required' }
      })
    })

    it('should not list the trades', () => {
      expect(listTradesMock).not.toHaveBeenCalled()
    })
  })

  describe('and a parameter is invalid', () => {
    beforeEach(async () => {
      query = `?signer=${SIGNER}&status=pending`
      response = await handle()
    })

    it('should respond with a 400 and the invalid parameter', () => {
      expect(response).toEqual({
        status: StatusCode.BAD_REQUEST,
        body: { ok: false, message: 'The value of the status parameter is invalid: pending' }
      })
    })

    it('should not list the trades', () => {
      expect(listTradesMock).not.toHaveBeenCalled()
    })
  })

  describe('and listing the trades fails', () => {
    beforeEach(async () => {
      query = `?signer=${SIGNER}`
      listTradesMock.mockRejectedValueOnce(new Error('Database is down'))
      response = await handle()
    })

    it('should respond with a 500 and a generic message', () => {
      expect(response).toEqual({ status: StatusCode.ERROR, body: { ok: false, message: 'Could not list the trades' } })
    })

    it('should log the error', () => {
      expect(errorLogMock).toHaveBeenCalledWith('Could not list the trades', { error: 'Database is down' })
    })
  })
})
