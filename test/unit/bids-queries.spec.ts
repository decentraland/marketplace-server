import { Network, ChainId, ListingStatus } from '@dcl/schemas'
import { BID_COLUMNS, getBidTradesQuery, getBidsQuery, getLegacyBidsQuery } from '../../src/ports/bids/queries'
import { SquidNetwork } from '../../src/types'

jest.mock('../../src/logic/chainIds', () => ({
  getEthereumChainId: () => ChainId.ETHEREUM_SEPOLIA,
  getPolygonChainId: () => ChainId.MATIC_AMOY
}))

function extractColumnAliases(sql: string): string[] {
  const selectMatch = sql.match(/SELECT\s+([\s\S]*?)\s+FROM\s/i)
  if (!selectMatch) return []
  // Split on commas that are not inside parentheses
  const columns: string[] = []
  let depth = 0
  let current = ''
  for (const char of selectMatch[1]) {
    if (char === '(') depth++
    else if (char === ')') depth--
    else if (char === ',' && depth === 0) {
      columns.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) columns.push(current.trim())

  return columns.map(col => {
    const asMatch = col.match(/\bas\s+(\w+)\s*$/i)
    if (asMatch) return asMatch[1]
    // Strip type casts like ::text, ::numeric(78)
    const stripped = col.replace(/::\w+(\(\d+\))?/g, '').trim()
    const parts = stripped.split('.')
    return (parts.pop() ?? '').trim()
  })
}

describe('when checking UNION ALL column alignment', () => {
  it('should have getBidTradesQuery and getLegacyBidsQuery output identical columns in BID_COLUMNS order', () => {
    const tradeColumns = extractColumnAliases(getBidTradesQuery())
    const legacyColumns = extractColumnAliases(getLegacyBidsQuery())

    expect(tradeColumns).toEqual([...BID_COLUMNS])
    expect(legacyColumns).toEqual([...BID_COLUMNS])
  })
})

describe('when querying for bids', () => {
  it('should use UNION ALL instead of NATURAL FULL OUTER JOIN', () => {
    const query = getBidsQuery({})
    expect(query.text).toContain('UNION ALL')
    expect(query.text).not.toContain('NATURAL FULL OUTER JOIN')
  })

  it('should only query the ones not expired', () => {
    const query = getBidsQuery({})
    expect(query.text).toContain('expires_at > now()::timestamptz(3)')
  })

  describe('and limit and offset are defined', () => {
    it('should apply outer LIMIT and OFFSET', () => {
      const query = getBidsQuery({ offset: 2, limit: 1 })
      expect(query.text).toContain('LIMIT')
      expect(query.text).toContain('OFFSET')
      expect(query.values).toEqual(expect.arrayContaining([1, 2]))
    })

    it('should push inner LIMIT into both subqueries before UNION ALL', () => {
      const query = getBidsQuery({ offset: 10, limit: 5 })
      const parts = query.text.split('UNION ALL')
      expect(parts).toHaveLength(2)
      // Inner limit should be limit + offset = 15 in each branch
      expect(query.values).toEqual(expect.arrayContaining([15]))
    })
  })

  describe('and the bidder filter is defined', () => {
    it('should add the filter to the query', () => {
      const query = getBidsQuery({ bidder: '0x1', offset: 1, limit: 1 })
      expect(query.text).toContain('LOWER(bidder) = LOWER($1)')
      expect(query.values).toEqual(expect.arrayContaining(['0x1']))
    })
  })

  describe('and the seller filter is defined', () => {
    it('should add the filter to the query', () => {
      const query = getBidsQuery({ seller: '0x12', offset: 1, limit: 1 })
      expect(query.text).toContain('LOWER(seller) = LOWER($1)')
      expect(query.values).toEqual(expect.arrayContaining(['0x12']))
    })
  })

  describe('and the contract address filter is defined', () => {
    it('should add the filter to the query', () => {
      const query = getBidsQuery({ contractAddress: '0x123', offset: 1, limit: 1 })
      expect(query.text).toContain('contract_address = $1')
      expect(query.values).toEqual(expect.arrayContaining(['0x123']))
    })
  })

  describe('and the token id filter is defined', () => {
    it('should add the filter to the query', () => {
      const query = getBidsQuery({ tokenId: 'a-token-id', offset: 1, limit: 1 })
      expect(query.text).toContain('LOWER(token_id) = LOWER($1)')
      expect(query.values).toEqual(expect.arrayContaining(['a-token-id']))
    })
  })

  describe('and the item id filter is defined', () => {
    it('should add the filter to the query', () => {
      const query = getBidsQuery({ itemId: 'an-item-id', offset: 1, limit: 1 })
      expect(query.text).toContain('LOWER(item_id) = LOWER($1)')
      expect(query.values).toEqual(expect.arrayContaining(['an-item-id']))
    })

    it('should exclude legacy bids with FALSE filter in the legacy branch WHERE clause', () => {
      const query = getBidsQuery({ itemId: 'an-item-id', offset: 1, limit: 1 })
      // Split the query at UNION ALL and verify FALSE appears only in the legacy (second) branch
      const parts = query.text.split('UNION ALL')
      expect(parts).toHaveLength(2)
      expect(parts[0]).not.toContain('FALSE')
      expect(parts[1]).toContain('FALSE')
    })
  })

  describe('and the network is defined', () => {
    describe('and the network is MATIC', () => {
      it('should add the filter to the query', () => {
        const query = getBidsQuery({ network: Network.MATIC, offset: 1, limit: 1 })
        expect(query.text).toContain('network = ANY ($1)')
        expect(query.values).toEqual(expect.arrayContaining([[Network.MATIC, SquidNetwork.POLYGON]]))
      })
    })

    describe('and the network is ETHEREUM', () => {
      it('should add the filter to the query', () => {
        const query = getBidsQuery({ network: Network.ETHEREUM, offset: 1, limit: 1 })
        expect(query.text).toContain('network = ANY ($1)')
        expect(query.values).toEqual(expect.arrayContaining([[Network.ETHEREUM, SquidNetwork.ETHEREUM]]))
      })
    })
  })

  describe('and the status is defined', () => {
    it('should add the filter to the query', () => {
      const query = getBidsQuery({ status: ListingStatus.OPEN })
      expect(query.text).toContain('status = $1')
      expect(query.values).toEqual(expect.arrayContaining(['open']))
    })
  })
})
