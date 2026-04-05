import { ChainId, EmoteCategory, NFTCategory, Network, WearableCategory } from '@dcl/schemas'
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

    it('should include all JOINs', () => {
      const query = getItemsQuery({})
      expect(query.text).toContain('metadata')
      expect(query.text).toContain('wearable')
      expect(query.text).toContain('emote')
      expect(query.text).toContain('unified_trades')
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

    it('should not include metadata or wearable or emote JOINs', () => {
      const query = getItemsCountQuery({})
      expect(query.text).not.toContain('LEFT JOIN')
    })

    it('should not include trades JOIN', () => {
      const query = getItemsCountQuery({})
      expect(query.text).not.toContain('LEFT JOIN unified_trades')
    })
  })

  describe('when the network filter is provided', () => {
    it('should apply the network filter without unnecessary JOINs', () => {
      const query = getItemsCountQuery({ network: Network.MATIC })
      expect(query.text).toContain('item.network = ANY')
      expect(query.text).not.toContain('LEFT JOIN')
    })
  })

  describe('when the category filter is provided', () => {
    it('should apply the category filter', () => {
      const query = getItemsCountQuery({ category: NFTCategory.WEARABLE })
      expect(query.text).toContain('item.item_type')
    })
  })

  describe('when the creator filter is provided', () => {
    it('should apply the creator filter without unnecessary JOINs', () => {
      const query = getItemsCountQuery({ creator: '0x123' })
      expect(query.text).toContain('item.creator')
      expect(query.text).not.toContain('LEFT JOIN')
    })
  })

  describe('when contractAddresses filter is provided', () => {
    it('should apply the contract address filter', () => {
      const query = getItemsCountQuery({ contractAddresses: ['0xabc'] })
      expect(query.text).toContain('item.collection_id = ANY')
    })
  })

  describe('when wearableCategory filter is provided', () => {
    it('should include metadata and wearable JOINs', () => {
      const query = getItemsCountQuery({ wearableCategory: WearableCategory.HAT })
      expect(query.text).toContain('metadata')
      expect(query.text).toContain('wearable')
    })

    it('should not include emote or trades JOINs', () => {
      const query = getItemsCountQuery({ wearableCategory: WearableCategory.HAT })
      expect(query.text).not.toContain('emote')
      expect(query.text).not.toContain('LEFT JOIN unified_trades')
    })
  })

  describe('when emoteCategory filter is provided', () => {
    it('should include metadata and emote JOINs', () => {
      const query = getItemsCountQuery({ emoteCategory: EmoteCategory.DANCE })
      expect(query.text).toContain('metadata')
      expect(query.text).toContain('emote')
    })

    it('should not include wearable or trades JOINs', () => {
      const query = getItemsCountQuery({ emoteCategory: EmoteCategory.DANCE })
      expect(query.text).not.toContain('wearable')
      expect(query.text).not.toContain('LEFT JOIN unified_trades')
    })
  })

  describe('when isOnSale filter is provided', () => {
    it('should include trades JOIN', () => {
      const query = getItemsCountQuery({ isOnSale: true })
      expect(query.text).toContain('unified_trades')
    })

    it('should not include metadata JOINs', () => {
      const query = getItemsCountQuery({ isOnSale: true })
      expect(query.text).not.toContain('metadata')
    })
  })

  describe('when minPrice filter is provided', () => {
    it('should include trades JOIN', () => {
      const query = getItemsCountQuery({ minPrice: '1000' })
      expect(query.text).toContain('unified_trades')
    })
  })
})
