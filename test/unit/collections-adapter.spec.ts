import { ChainId, Network } from '@dcl/schemas'
import { fromDBCollectionToCollection } from '../../src/adapters/collections'
import { Collection, DBCollection } from '../../src/ports/collections/types'
import { SquidNetwork } from '../../src/types'

describe('when transforming a DBCollection to Collection', () => {
  const baseDBCollection: DBCollection = {
    id: '0x1234567890abcdef1234567890abcdef12345678',
    owner: '0xowner1234567890abcdef1234567890abcdef1234',
    creator: '0xcreator1234567890abcdef1234567890abcdef12',
    name: 'Test Collection',
    symbol: 'TEST',
    is_completed: true,
    is_approved: true,
    is_editable: false,
    minters: ['0xminter1234567890abcdef1234567890abcdef123'],
    managers: ['0xmanager1234567890abcdef1234567890abcdef12'],
    urn: 'urn:decentraland:matic:collections-v2:0x1234567890abcdef1234567890abcdef12345678',
    items_count: 10,
    created_at: 1640000000,
    updated_at: 1650000000,
    reviewed_at: 1655000000,
    first_listed_at: 1660000000,
    search_is_store_minter: true,
    search_text: 'test collection',
    base_uri: 'https://example.com/',
    chain_id: ChainId.MATIC_MAINNET,
    network: SquidNetwork.POLYGON,
    count: 1
  }

  describe('and all fields are present', () => {
    let result: Collection

    beforeEach(() => {
      result = fromDBCollectionToCollection(baseDBCollection)
    })

    it('should transform the urn correctly', () => {
      expect(result.urn).toBe('urn:decentraland:matic:collections-v2:0x1234567890abcdef1234567890abcdef12345678')
    })

    it('should transform the creator correctly', () => {
      expect(result.creator).toBe('0xcreator1234567890abcdef1234567890abcdef12')
    })

    it('should transform the name correctly', () => {
      expect(result.name).toBe('Test Collection')
    })

    it('should transform the contract address from id', () => {
      expect(result.contractAddress).toBe('0x1234567890abcdef1234567890abcdef12345678')
    })

    it('should convert created_at from seconds to milliseconds', () => {
      expect(result.createdAt).toBe(1640000000000)
    })

    it('should convert updated_at from seconds to milliseconds', () => {
      expect(result.updatedAt).toBe(1650000000000)
    })

    it('should convert reviewed_at from seconds to milliseconds', () => {
      expect(result.reviewedAt).toBe(1655000000000)
    })

    it('should transform search_is_store_minter to isOnSale', () => {
      expect(result.isOnSale).toBe(true)
    })

    it('should transform items_count to size', () => {
      expect(result.size).toBe(10)
    })

    it('should convert first_listed_at from seconds to milliseconds', () => {
      expect(result.firstListedAt).toBe(1660000000000)
    })
  })

  describe('and the network is POLYGON', () => {
    let result: Collection

    beforeEach(() => {
      const dbCollection = {
        ...baseDBCollection,
        network: SquidNetwork.POLYGON,
        chain_id: ChainId.MATIC_MAINNET
      }

      result = fromDBCollectionToCollection(dbCollection)
    })

    it('should set network to MATIC', () => {
      expect(result.network).toBe(Network.MATIC)
    })

    it('should set chainId to polygon chain id', () => {
      expect(result.chainId).toBe(ChainId.MATIC_MAINNET)
    })
  })

  describe('and the network is ETHEREUM', () => {
    let result: Collection

    beforeEach(() => {
      const dbCollection = {
        ...baseDBCollection,
        network: SquidNetwork.ETHEREUM,
        chain_id: ChainId.ETHEREUM_MAINNET
      }

      result = fromDBCollectionToCollection(dbCollection)
    })

    it('should set network to ETHEREUM', () => {
      expect(result.network).toBe(Network.ETHEREUM)
    })

    it('should set chainId to ethereum chain id', () => {
      expect(result.chainId).toBe(ChainId.ETHEREUM_MAINNET)
    })
  })
})
