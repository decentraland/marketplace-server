import { ChainId, ListingStatus, Network } from '@dcl/schemas'
import { fromDBBidToBid, fromDBNetworkToNetwork, getChainIdFromDBBid } from '../../src/adapters/bids/bids'
import { DBBid, DBLegacyBid, DBTradeBid, WithCount } from '../../src/ports/bids'
import { SquidNetwork } from '../../src/types'

describe('when adapting a db bid to a bid', () => {
  describe('and it is a bid trade', () => {
    let dbBid: WithCount<DBTradeBid>

    describe('and the bid is for an nft', () => {
      beforeEach(() => {
        dbBid = {
          bids_count: 10,
          trade_id: '1',
          trade_contract_address: '0x1',
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
          fingerprint: '123',
          status: ListingStatus.OPEN,
          seller: '0x123',
          legacy_bid_id: null
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
          status: dbBid.status,
          seller: dbBid.seller,
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
          trade_contract_address: '0x1',
          bids_count: 10,
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
          fingerprint: '123',
          status: ListingStatus.OPEN,
          seller: '0x123',
          legacy_bid_id: null
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
          status: dbBid.status,
          seller: dbBid.seller,
          network: dbBid.network,
          chainId: dbBid.chain_id,
          contractAddress: dbBid.contract_address,
          expiresAt: dbBid.expires_at.getTime()
        })
      })
    })
  })

  describe('and it is a legacy bid', () => {
    let dbBid: WithCount<DBLegacyBid>

    beforeEach(() => {
      dbBid = {
        bids_count: 10,
        trade_id: null,
        price: '10',
        token_id: 'token-id',
        created_at: new Date(),
        updated_at: new Date(),
        network: Network.ETHEREUM,
        chain_id: ChainId.ETHEREUM_SEPOLIA,
        bidder: '0x1',
        contract_address: '0x1',
        expires_at: new Date(),
        fingerprint: '123',
        status: ListingStatus.OPEN,
        seller: '0x123',
        legacy_bid_id: '0x123',
        bid_address: '0x1234',
        block_number: '1',
        blockchain_id: '0x123'
      }
    })

    it('should return the correct bid structure', () => {
      const result = fromDBBidToBid(dbBid)

      expect(result).toEqual({
        id: dbBid.legacy_bid_id,
        bidder: dbBid.bidder,
        price: dbBid.price,
        createdAt: dbBid.created_at.getTime(),
        updatedAt: dbBid.updated_at.getTime(),
        tokenId: dbBid.token_id,
        fingerprint: dbBid.fingerprint || '',
        status: dbBid.status,
        seller: dbBid.seller,
        network: dbBid.network,
        chainId: dbBid.chain_id,
        contractAddress: dbBid.contract_address,
        expiresAt: dbBid.expires_at.getTime(),
        bidAddress: dbBid.bid_address,
        blockNumber: dbBid.block_number,
        blockchainId: dbBid.blockchain_id
      })
    })
  })
})

describe('when adapting a db network to a network', () => {
  describe.each([
    { dbNetwork: SquidNetwork.ETHEREUM, network: Network.ETHEREUM },
    { dbNetwork: SquidNetwork.POLYGON, network: Network.MATIC }
  ])('and the network is $dbNetwork', ({ dbNetwork, network }) => {
    it(`should return the correct network: ${network}`, () => {
      expect(fromDBNetworkToNetwork(dbNetwork)).toEqual(network)
    })
  })
})

describe('when getting the bid chain id', () => {
  const envValues = process.env

  beforeEach(() => {
    jest.resetModules() // Most important - it clears the cache
    process.env = { ...envValues } // Make a copy
  })

  afterAll(() => {
    process.env = envValues // Restore old environment
  })

  describe('when chainId is defined in dbBid', () => {
    it('should return the dbBid chainId', () => {
      const dbBid = { network: Network.ETHEREUM, chain_id: ChainId.ETHEREUM_MAINNET } as DBBid
      expect(getChainIdFromDBBid(dbBid)).toEqual(dbBid.chain_id)
    })
  })

  describe('when chainId is not defined in dbBid', () => {
    beforeEach(() => {
      process.env = {
        ETHEREUM_CHAIN_ID: '123',
        POLYGON_CHAIN_ID: '456'
      }
    })
    describe('and the bid network is ETHEREUM', () => {
      it('should return the ETHEREUM_CHAIN_ID from env variables', () => {
        const dbBid = { network: Network.ETHEREUM } as DBBid
        expect(getChainIdFromDBBid(dbBid)).toEqual(parseInt(process.env.ETHEREUM_CHAIN_ID as string))
      })
    })

    describe('and the bid network is MATIC', () => {
      it('should return the POLYGON_CHAIN_ID from env variables', () => {
        const dbBid = { network: Network.MATIC } as DBBid
        expect(getChainIdFromDBBid(dbBid)).toEqual(parseInt(process.env.POLYGON_CHAIN_ID as string))
      })
    })

    describe('and the bid network is POLYGON', () => {
      it('should return the POLYGON_CHAIN_ID from env variables', () => {
        const dbBid = { network: SquidNetwork.POLYGON } as DBBid
        expect(getChainIdFromDBBid(dbBid)).toEqual(parseInt(process.env.POLYGON_CHAIN_ID as string))
      })
    })
  })
})
