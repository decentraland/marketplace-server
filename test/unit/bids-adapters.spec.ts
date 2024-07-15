import { ChainId, ListingStatus, Network } from '@dcl/schemas'
import { fromDBBidToBid } from '../../src/adapters/bids/bids'
import { DBBid } from '../../src/ports/bids'

let dbBid: DBBid

describe('when adapting a db bid to a bid', () => {
  describe('and the bid is for an nft', () => {
    beforeEach(() => {
      dbBid = {
        count: 10,
        trade_id: '1',
        price: '10',
        token_id: 'token-id',
        created_at: new Date(),
        updated_at: new Date(),
        network: Network.ETHEREUM,
        chain_id: ChainId.ETHEREUM_SEPOLIA,
        bidder: '0x1',
        contract_address: '0x1',
        expires_at: new Date(),
        item_id: null,
        fingerprint: '123'
      }
    })

    it('should return the correct bid structure', () => {
      const result = fromDBBidToBid(dbBid)

      expect(result).toEqual({
        id: dbBid.trade_id,
        tradeId: dbBid.trade_id,
        bidder: dbBid.bidder,
        price: dbBid.price,
        createdAt: dbBid.created_at.getTime(),
        updatedAt: dbBid.updated_at.getTime(),
        tokenId: 'token-id',
        fingerprint: dbBid.fingerprint || '',
        status: ListingStatus.CANCELLED,
        seller: '',
        network: dbBid.network,
        chainId: dbBid.chain_id,
        contractAddress: dbBid.contract_address,
        expiresAt: dbBid.expires_at.getTime()
      })
    })
  })

  describe('and the bid is for an item', () => {
    beforeEach(() => {
      dbBid = {
        count: 10,
        trade_id: '1',
        price: '10',
        token_id: null,
        created_at: new Date(),
        updated_at: new Date(),
        network: Network.ETHEREUM,
        chain_id: ChainId.ETHEREUM_SEPOLIA,
        bidder: '0x1',
        contract_address: '0x1',
        expires_at: new Date(),
        item_id: 'item-id',
        fingerprint: '123'
      }
    })

    it('should return the correct bid structure', () => {
      const result = fromDBBidToBid(dbBid)

      expect(result).toEqual({
        id: dbBid.trade_id,
        tradeId: dbBid.trade_id,
        bidder: dbBid.bidder,
        price: dbBid.price,
        createdAt: dbBid.created_at.getTime(),
        updatedAt: dbBid.updated_at.getTime(),
        itemId: 'item-id',
        fingerprint: dbBid.fingerprint || '',
        status: ListingStatus.CANCELLED,
        seller: '',
        network: dbBid.network,
        chainId: dbBid.chain_id,
        contractAddress: dbBid.contract_address,
        expiresAt: dbBid.expires_at.getTime()
      })
    })
  })
})
