import { TradeType } from '@dcl/schemas'
import { getAllTradesQuery, getTradesByAddressQuery, getTradesForTypeQuery, getTradeStatusByIdQuery } from '../../src/ports/trades/queries'

const CONTRACT_STATUS_JOIN =
  /LEFT JOIN squid_trades\.contract_status AS trade_contract_status\s+ON trade_contract_status\.address = LOWER\(t\.contract\)\s+AND trade_contract_status\.network = CASE WHEN t\.network = 'MATIC' THEN 'POLYGON' ELSE t\.network END/

describe('when building the trades query for a type', () => {
  let text: string

  beforeEach(() => {
    text = getTradesForTypeQuery(TradeType.BID)
  })

  it('should join the status of the marketplace the trade targets, translating MATIC to POLYGON', () => {
    expect(text).toMatch(CONTRACT_STATUS_JOIN)
  })

  it('should expose whether that marketplace is paused, defaulting to false', () => {
    expect(text).toContain('COALESCE(bool_or(trade_contract_status.paused), false) AS paused')
  })

  it('should keep grouping by the trade alone', () => {
    expect(text).toMatch(
      /GROUP BY t\.id, t\.created_at, t\.network, t\.chain_id, t\.signer, t\.checks, contract_signature_index\.index, signer_signature_index\.index\s*$/
    )
  })
})

describe('when building the status query for a single trade', () => {
  let text: string
  let values: unknown[]

  beforeEach(() => {
    const query = getTradeStatusByIdQuery(TradeType.PUBLIC_ITEM_ORDER, 'trade-id')
    text = query.text
    values = query.values
  })

  it('should bind the trade id instead of inlining it', () => {
    expect(values).toEqual(['trade-id'])
  })

  it('should narrow the trades before grouping them', () => {
    expect(text.indexOf('AND t.id = $1')).toBeLessThan(text.indexOf('GROUP BY t.id'))
  })

  it('should compute the status with the same rules as the trade lists', () => {
    const caseBody = (s: string) => s.slice(s.indexOf('CASE'), s.indexOf('END AS status'))
    expect(caseBody(text)).toBe(caseBody(getTradesForTypeQuery(TradeType.PUBLIC_ITEM_ORDER)))
  })

  it('should select the status and the paused flag', () => {
    expect(text).toMatch(/^SELECT trade_by_id\.status, trade_by_id\.paused FROM \(/)
  })
})

describe('when building the query for the trades of an address', () => {
  let text: string
  let values: unknown[]

  beforeEach(() => {
    const query = getTradesByAddressQuery('0xUser', { limit: 10, offset: 5 })
    text = query.text
    values = query.values
  })

  it('should expose whether each trade marketplace is paused', () => {
    expect(text).toContain('COALESCE(trade_contract_status.paused, false) AS trade_paused')
  })

  it('should join the marketplace status by contract and network', () => {
    expect(text).toMatch(CONTRACT_STATUS_JOIN)
  })

  it('should keep binding the address and the pagination', () => {
    expect(values).toEqual(['0xuser', '0xuser', 10, 5])
  })
})

describe('when building the query for every trade', () => {
  let text: string

  beforeEach(() => {
    text = getAllTradesQuery().text
  })

  it('should select every trade with its paused flag', () => {
    expect(text).toMatch(/^SELECT t\.\*, COALESCE\(trade_contract_status\.paused, false\) AS paused FROM marketplace\.trades AS t/)
  })

  it('should join the marketplace status by contract and network', () => {
    expect(text).toMatch(CONTRACT_STATUS_JOIN)
  })
})
