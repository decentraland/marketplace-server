import { ChainId, ListingStatus, Network } from '@dcl/schemas'
import { getOrdersCountQuery, getOrdersQuery } from '../../src/ports/orders/queries'

jest.mock('../../src/logic/chainIds', () => ({
  getEthereumChainId: () => ChainId.ETHEREUM_SEPOLIA,
  getPolygonChainId: () => ChainId.MATIC_AMOY
}))

describe('getOrdersQuery', () => {
  describe('when no filters are provided', () => {
    it('should not include COUNT(*) OVER() in inner queries', () => {
      const query = getOrdersQuery({})
      expect(query.text).not.toContain('COUNT(*) OVER()')
    })

    it('should include pagination', () => {
      const query = getOrdersQuery({})
      expect(query.text).toContain('LIMIT')
      expect(query.text).toContain('OFFSET')
    })
  })
})

describe('getOrdersCountQuery', () => {
  describe('when no filters are provided', () => {
    it('should sum counts from both trades and legacy orders', () => {
      const query = getOrdersCountQuery({})
      expect(query.text).toContain('SELECT (')
      expect(query.text).toContain('SELECT COUNT(*) FROM (')
      expect(query.text).toContain(') + (')
      expect(query.text).toContain('as count')
    })

    it('should not include pagination', () => {
      const query = getOrdersCountQuery({})
      const afterCount = query.text.split('as count')[0]
      expect(afterCount).not.toMatch(/LIMIT \$\d/)
    })

    it('should not include ORDER BY', () => {
      const query = getOrdersCountQuery({})
      expect(query.text).not.toContain('ORDER BY')
    })
  })

  describe('when the network filter is provided', () => {
    it('should apply the network filter', () => {
      const query = getOrdersCountQuery({ network: Network.MATIC })
      expect(query.text).toContain('network = ANY')
    })
  })

  describe('when the owner filter is provided', () => {
    it('should apply the owner filter', () => {
      const query = getOrdersCountQuery({ owner: '0x123' })
      expect(query.text).toContain('LOWER(owner) = LOWER')
    })
  })

  describe('when the status filter is provided', () => {
    it('should apply the status filter', () => {
      const query = getOrdersCountQuery({ status: ListingStatus.OPEN })
      expect(query.text).toContain('status =')
    })
  })

  describe('when the tokenId filter is provided', () => {
    it('should apply the tokenId filter to both trades and orders', () => {
      const query = getOrdersCountQuery({ tokenId: '123' })
      expect(query.text).toContain('nft.token_id =')
      expect(query.text).toContain('token_id =')
    })
  })
})
