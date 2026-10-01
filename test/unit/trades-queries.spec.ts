import { Network, TradeType } from '@dcl/schemas'
import { PausedContract } from '../../src/ports/contract-status/types'
import {
  getAllTradesQuery,
  getMarketplaceContractPausedQuery,
  getOpenItemOrderQuery,
  getOpenNFTOrderQuery,
  getTradesByAddressQuery,
  getTradesForTypeQuery,
  getTradeStatusByIdQuery
} from '../../src/ports/trades/queries'

const PAUSED_MATCH = /\(LOWER\(t\.contract\) \|\| '-' \|\| t\.network\) = ANY\(\$\d+::text\[\]\) AS paused/

describe('when building the trades query for a type', () => {
  let text: string
  let values: unknown[]
  let pausedContracts: PausedContract[]

  describe('and no marketplace contract is paused', () => {
    beforeEach(() => {
      pausedContracts = []
      const query = getTradesForTypeQuery(TradeType.BID, pausedContracts)
      text = query.text
      values = query.values
    })

    it('should report every trade as not paused without reading any status table', () => {
      expect(text).toContain('false AS paused')
      expect(text).not.toContain('contract_status')
    })

    it('should bind no values', () => {
      expect(values).toEqual([])
    })

    it('should keep grouping by the trade alone', () => {
      expect(text).toMatch(
        /GROUP BY t\.id, t\.created_at, t\.network, t\.chain_id, t\.signer, t\.checks, contract_signature_index\.index, signer_signature_index\.index\s*$/
      )
    })
  })

  describe('and a marketplace contract is paused', () => {
    beforeEach(() => {
      pausedContracts = [{ address: '0xabc', network: Network.MATIC }]
      const query = getTradesForTypeQuery(TradeType.BID, pausedContracts)
      text = query.text
      values = query.values
    })

    it('should match the trade contract and network against the paused set', () => {
      expect(text).toMatch(PAUSED_MATCH)
    })

    it('should bind the paused set as contract-network keys', () => {
      expect(values).toEqual([['0xabc-MATIC']])
    })
  })
})

describe('when building the duplicate-order guards', () => {
  describe('and the order is for an item', () => {
    let text: string

    beforeEach(() => {
      text = getOpenItemOrderQuery('0xcontract', '1', Network.MATIC, []).text
    })

    it('should ignore open orders on a paused marketplace', () => {
      expect(text).toContain('AND NOT item_order_trades.paused')
    })
  })

  describe('and the order is for an nft', () => {
    let text: string

    beforeEach(() => {
      text = getOpenNFTOrderQuery('0xcontract', '1', Network.MATIC, []).text
    })

    it('should ignore open orders on a paused marketplace', () => {
      expect(text).toContain('AND NOT nft_order_trades.paused')
    })
  })
})

describe('when building the status query for a single trade', () => {
  let text: string
  let values: unknown[]

  beforeEach(() => {
    const query = getTradeStatusByIdQuery(TradeType.PUBLIC_ITEM_ORDER, 'trade-id', [{ address: '0xabc', network: Network.MATIC }])
    text = query.text
    values = query.values
  })

  it('should bind the paused set and the trade id instead of inlining them', () => {
    expect(values).toEqual([['0xabc-MATIC'], 'trade-id'])
  })

  it('should narrow the trades before grouping them', () => {
    expect(text.indexOf('AND t.id = $2')).toBeLessThan(text.indexOf('GROUP BY t.id'))
  })

  it('should compute the status with the same rules as the trade lists', () => {
    const caseBody = (s: string) => s.slice(s.indexOf('CASE'), s.indexOf('END AS status'))
    expect(caseBody(text)).toBe(caseBody(getTradesForTypeQuery(TradeType.PUBLIC_ITEM_ORDER, []).text))
  })

  it('should select the status and the paused flag', () => {
    expect(text).toMatch(/^SELECT trade_by_id\.status, trade_by_id\.paused FROM \(/)
  })
})

describe('when building the marketplace pause lookup', () => {
  let values: unknown[]
  let text: string

  beforeEach(() => {
    const query = getMarketplaceContractPausedQuery('0xABCdef', Network.MATIC)
    values = query.values
    text = query.text
  })

  it('should bind the lowercased contract address and the network the indexer writes', () => {
    expect(values).toEqual(['0xabcdef', 'POLYGON'])
  })

  it('should match both columns', () => {
    expect(text).toContain('WHERE address = $1 AND network = $2')
  })
})

describe('when building the query for the trades of an address', () => {
  let text: string
  let values: unknown[]

  beforeEach(() => {
    const query = getTradesByAddressQuery('0xUser', { limit: 10, offset: 5 }, [{ address: '0xabc', network: Network.ETHEREUM }])
    text = query.text
    values = query.values
  })

  it('should expose whether each trade marketplace is paused', () => {
    expect(text).toMatch(/\(LOWER\(t\.contract\) \|\| '-' \|\| t\.network\) = ANY\(\$1::text\[\]\) AS trade_paused/)
  })

  it('should bind the paused set, the address and the pagination', () => {
    expect(values).toEqual([['0xabc-ETHEREUM'], '0xuser', '0xuser', 10, 5])
  })
})

describe('when building the query for every trade', () => {
  let text: string

  describe('and no marketplace contract is paused', () => {
    beforeEach(() => {
      text = getAllTradesQuery([]).text
    })

    it('should select every trade as not paused', () => {
      expect(text).toBe('SELECT t.*, false AS paused FROM marketplace.trades AS t')
    })
  })

  describe('and a marketplace contract is paused', () => {
    beforeEach(() => {
      text = getAllTradesQuery([{ address: '0xabc', network: Network.MATIC }]).text
    })

    it('should flag the trades on it as paused', () => {
      expect(text).toMatch(PAUSED_MATCH)
    })
  })
})
