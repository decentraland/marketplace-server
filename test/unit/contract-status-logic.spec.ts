import { getPausedExpression } from '../../src/logic/trades/contract-status'
import { fromSquidNetwork, toSquidNetwork, toSquidNetworkSql } from '../../src/logic/trades/squid-network'
import { PausedContract } from '../../src/ports/contract-status/types'

describe('when building the paused expression of a trade', () => {
  let pausedContracts: PausedContract[]
  let text: string
  let values: unknown[]

  describe('and no contract is paused', () => {
    beforeEach(() => {
      pausedContracts = []
      const query = getPausedExpression(pausedContracts, 't.contract', 't.network')
      text = query.text
      values = query.values
    })

    it('should be a constant false with nothing bound', () => {
      expect({ text, values }).toEqual({ text: 'false', values: [] })
    })
  })

  describe('and contracts are paused', () => {
    beforeEach(() => {
      pausedContracts = [
        { address: '0xABC', network: 'MATIC' },
        { address: '0xabc', network: 'ETHEREUM' }
      ]
      const query = getPausedExpression(pausedContracts, 't.contract', 't.network')
      text = query.text
      values = query.values
    })

    it('should match the lowercased contract and its network against the paused keys', () => {
      expect(text).toBe("(LOWER(t.contract) || '-' || t.network) = ANY($1::text[])")
    })

    // The same address can be a different deployment on each chain.
    it('should keep the network in every key', () => {
      expect(values).toEqual([['0xabc-MATIC', '0xabc-ETHEREUM']])
    })
  })
})

describe('when translating networks between the trades and the indexer', () => {
  it('should spell MATIC as POLYGON for the indexer', () => {
    expect(toSquidNetwork('MATIC')).toBe('POLYGON')
  })

  it('should keep ETHEREUM as is for the indexer', () => {
    expect(toSquidNetwork('ETHEREUM')).toBe('ETHEREUM')
  })

  it('should spell the indexer POLYGON as MATIC', () => {
    expect(fromSquidNetwork('POLYGON')).toBe('MATIC')
  })

  it('should keep the indexer ETHEREUM as is', () => {
    expect(fromSquidNetwork('ETHEREUM')).toBe('ETHEREUM')
  })

  it('should translate a column in SQL', () => {
    expect(toSquidNetworkSql('t.network')).toBe("CASE WHEN t.network = 'MATIC' THEN 'POLYGON' ELSE t.network END")
  })
})
