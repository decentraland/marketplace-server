import { ListingStatus, OrderFilters } from '@dcl/schemas'
import { getOrdersCountQuery, getOrdersQuery } from '../../src/ports/orders/queries'

// Whitespace-tolerant matcher so the regression guard still catches a reintroduced window aggregate
// written as `COUNT(*) OVER ()`, `COUNT( * )OVER(`, etc.
const COUNT_OVER = /COUNT\(\s*\*\s*\)\s*OVER\s*\(/i

describe('when building the orders queries', () => {
  let filters: OrderFilters

  beforeEach(() => {
    filters = { first: 20, skip: 0 }
  })

  describe('and building the data query (getOrdersQuery)', () => {
    it('should not compute a COUNT(*) OVER() window: its row count is unused (the total comes from getOrdersCountQuery)', () => {
      expect(getOrdersQuery(filters).text).not.toMatch(COUNT_OVER)
    })

    it('should still union the offchain trades and legacy orders sources', () => {
      const text = getOrdersQuery(filters).text
      expect(text).toContain('UNION ALL')
      expect(text).toContain('order_trades')
      expect(text).toContain('legacy_orders')
    })

    it('should still apply the LIMIT/OFFSET pagination', () => {
      const text = getOrdersQuery(filters).text
      expect(text).toContain('LIMIT')
      expect(text).toContain('OFFSET')
    })

    it('should keep both union branches free of the window count for a filtered shape too', () => {
      const text = getOrdersQuery({ ...filters, owner: '0x1', status: ListingStatus.OPEN }).text
      expect(text).not.toMatch(COUNT_OVER)
      expect(text).toContain('UNION ALL')
    })
  })

  describe('and building the count query (getOrdersCountQuery)', () => {
    it('should not compute a redundant COUNT(*) OVER() window: the outer COUNT(*) already produces the total', () => {
      expect(getOrdersCountQuery(filters).text).not.toMatch(COUNT_OVER)
    })

    it('should still aggregate the trades and orders counts into a single total', () => {
      const text = getOrdersCountQuery(filters).text
      expect(text).toContain('total_trades')
      expect(text).toContain('total_orders')
      expect(text).toContain('AS count')
    })
  })
})
