import { Network } from '@dcl/schemas'
import { getSalesCountQuery, getSalesQuery } from '../../src/ports/sales/queries'

describe('getSalesQuery', () => {
  describe('when no filters are provided', () => {
    it('should not include COUNT(*) OVER()', () => {
      const query = getSalesQuery({})
      expect(query.text).not.toContain('COUNT(*) OVER()')
    })

    it('should include pagination', () => {
      const query = getSalesQuery({})
      expect(query.text).toContain('LIMIT')
      expect(query.text).toContain('OFFSET')
    })

    it('should include sorting', () => {
      const query = getSalesQuery({})
      expect(query.text).toContain('ORDER BY')
    })
  })
})

describe('getSalesCountQuery', () => {
  describe('when no filters are provided', () => {
    it('should select COUNT(*) as count', () => {
      const query = getSalesCountQuery({})
      expect(query.text).toContain('SELECT COUNT(*) as count')
    })

    it('should not include pagination', () => {
      const query = getSalesCountQuery({})
      expect(query.text).not.toContain('LIMIT')
      expect(query.text).not.toContain('OFFSET')
    })

    it('should not include sorting', () => {
      const query = getSalesCountQuery({})
      expect(query.text).not.toContain('ORDER BY')
    })
  })

  describe('when filters are provided', () => {
    it('should apply the same filters as the data query', () => {
      const filters = { buyer: '0x123', network: Network.MATIC }
      const dataQuery = getSalesQuery(filters)
      const countQuery = getSalesCountQuery(filters)

      expect(countQuery.text).toContain('buyer =')
      expect(countQuery.text).toContain('network = ANY')
      expect(dataQuery.text).toContain('buyer =')
      expect(dataQuery.text).toContain('network = ANY')
    })
  })
})
