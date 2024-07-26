import { Network } from '@dcl/schemas'
import { getBidsQuery } from '../../src/ports/bids/queries'
import { SquidNetwork } from '../../src/types'

describe('when querying for bids', () => {
  describe('and limit and offset are defined', () => {
    const query = getBidsQuery({ offset: 2, limit: 1 })
    expect(query.text).toContain('LIMIT $1 OFFSET $2')
    expect(query.values).toEqual(expect.arrayContaining([1, 2]))
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
      expect(query.text).toContain('LOWER(contract_address) = LOWER($1)')
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
      const query = getBidsQuery({ tokenId: 'an-item-id', offset: 1, limit: 1 })
      expect(query.text).toContain('LOWER(token_id) = LOWER($1)')
      expect(query.values).toEqual(expect.arrayContaining(['an-item-id']))
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
})
