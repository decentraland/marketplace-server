import { ChainId, NFTCategory, Network } from '@dcl/schemas'
import { getItemsCountQuery, getItemsQuery } from '../../src/ports/items/queries'

jest.mock('../../src/logic/chainIds', () => ({
  getEthereumChainId: () => ChainId.ETHEREUM_SEPOLIA,
  getPolygonChainId: () => ChainId.MATIC_AMOY
}))

describe('getItemsQuery', () => {
  describe('when no filters are provided', () => {
    it('should not include COUNT(*) OVER()', () => {
      const query = getItemsQuery({})
      expect(query.text).not.toContain('COUNT(*) OVER()')
    })

    it('should include pagination', () => {
      const query = getItemsQuery({})
      expect(query.text).toContain('LIMIT')
      expect(query.text).toContain('OFFSET')
    })
  })
})

describe('getItemsCountQuery', () => {
  describe('when no filters are provided', () => {
    it('should select COUNT(*) as count', () => {
      const query = getItemsCountQuery({})
      expect(query.text).toContain('SELECT COUNT(*) as count')
    })

    it('should not include pagination', () => {
      const query = getItemsCountQuery({})
      expect(query.text).not.toContain('LIMIT')
      expect(query.text).not.toContain('OFFSET')
    })
  })

  describe('when the network filter is provided', () => {
    it('should apply the network filter', () => {
      const query = getItemsCountQuery({ network: Network.MATIC })
      expect(query.text).toContain('item.network = ANY')
    })
  })

  describe('when the category filter is provided', () => {
    it('should apply the category filter', () => {
      const query = getItemsCountQuery({ category: NFTCategory.WEARABLE })
      expect(query.text).toContain('item.item_type')
    })
  })

  describe('when the creator filter is provided', () => {
    it('should apply the creator filter', () => {
      const query = getItemsCountQuery({ creator: '0x123' })
      expect(query.text).toContain('item.creator')
    })
  })

  describe('when contractAddresses filter is provided', () => {
    it('should apply the contract address filter', () => {
      const query = getItemsCountQuery({ contractAddresses: ['0xabc'] })
      expect(query.text).toContain('item.collection_id = ANY')
    })
  })
})
