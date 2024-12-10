import { Network, ChainId, ListingStatus } from '@dcl/schemas'
import { getBidsQuery } from '../../src/ports/bids/queries'
import { SquidNetwork } from '../../src/types'

jest.mock('../../src/logic/chainIds', () => ({
  getEthereumChainId: () => ChainId.ETHEREUM_SEPOLIA,
  getPolygonChainId: () => ChainId.MATIC_AMOY
}))

describe('when querying for bids', () => {
  it('should only query the ones not expired', () => {
    const query = getBidsQuery({})
    expect(query.text).toContain('expires_at > now()::timestamptz(3)')
  })

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

  describe('and the status is defined', () => {
    it('should add the filter to the query', () => {
      const query = getBidsQuery({ status: ListingStatus.OPEN })
      expect(query.text).toContain('status = $1')
      expect(query.values).toEqual(expect.arrayContaining(['open']))
    })
  })
})
