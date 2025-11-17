import { Network } from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../src/constants'
import { getAccountsCountQuery, getAccountsQuery } from '../../src/ports/accounts/queries'
import { AccountFilters, AccountSortBy } from '../../src/ports/accounts/types'
import { SquidNetwork } from '../../src/types'

describe('getAccountsQuery', () => {
    let filters: AccountFilters
  describe('when no filters are provided', () => {
    beforeEach(() => {
      filters = {}
    })

    it('should return query with default sorting by sales', () => {
      const query = getAccountsQuery(filters)
      expect(query.text).toContain('ORDER BY sales DESC')
    })

    it('should return query with default pagination', () => {
      const query = getAccountsQuery(filters)
      expect(query.text).toContain('LIMIT')
      expect(query.text).toContain('OFFSET')
    })

    it('should select from the account table', () => {
      const query = getAccountsQuery(filters)
      expect(query.text).toContain(`${MARKETPLACE_SQUID_SCHEMA}.account`)
    })
  })

  describe('when sortBy filter is provided', () => {
    describe('and sortBy is most_sales', () => {
      beforeEach(() => {
        filters = { sortBy: AccountSortBy.MOST_SALES }
      })

      it('should order by sales DESC', () => {
        const query = getAccountsQuery(filters)
        expect(query.text).toContain('ORDER BY sales DESC')
      })
    })

    describe('and sortBy is most_purchases', () => {
      beforeEach(() => {
        filters = { sortBy: AccountSortBy.MOST_PURCHASES }
      })

      it('should order by purchases DESC', () => {
        const query = getAccountsQuery(filters)
        expect(query.text).toContain('ORDER BY purchases DESC')
      })
    })

    describe('and sortBy is most_royalties', () => {
      beforeEach(() => {
        filters = { sortBy: AccountSortBy.MOST_ROYALTIES }
      })

      it('should order by royalties DESC', () => {
        const query = getAccountsQuery(filters)
        expect(query.text).toContain('ORDER BY royalties DESC')
      })
    })

    describe('and sortBy is most_collections', () => {
      beforeEach(() => {
        filters = { sortBy: AccountSortBy.MOST_COLLECTIONS }
      })

      it('should order by collections DESC', () => {
        const query = getAccountsQuery(filters)
        expect(query.text).toContain('ORDER BY collections DESC')
      })
    })

    describe('and sortBy is most_earned', () => {
      beforeEach(() => {
        filters = { sortBy: AccountSortBy.MOST_EARNED }
      })

      it('should order by earned DESC', () => {
        const query = getAccountsQuery(filters)
        expect(query.text).toContain('ORDER BY earned DESC')
      })
    })

    describe('and sortBy is most_spent', () => {
      beforeEach(() => {
        filters = { sortBy: AccountSortBy.MOST_SPENT }
      })

      it('should order by spent DESC', () => {
        const query = getAccountsQuery(filters)
        expect(query.text).toContain('ORDER BY spent DESC')
      })
    })
  })

  describe('when pagination filters are provided', () => {
    beforeEach(() => {
      filters = { first: 50, skip: 10 }
    })

    it('should apply LIMIT and OFFSET correctly', () => {
      const query = getAccountsQuery(filters)
      expect(query.text).toContain('LIMIT')
      expect(query.text).toContain('OFFSET')
      expect(query.values).toContain(50)
      expect(query.values).toContain(10)
    })
  })

  describe('when id filter is provided', () => {
    beforeEach(() => {
      filters = { id: '0x1-polygon' }
    })

    it('should filter by id', () => {
      const query = getAccountsQuery(filters)
      expect(query.text).toContain('WHERE')
      expect(query.text).toContain('id =')
      expect(query.values).toContain('0x1-polygon')
    })
  })

  describe('when address filter is provided', () => {
    beforeEach(() => {
      filters = { address: ['0x1', '0x2'] }
    })

    it('should filter by addresses with lowercase comparison', () => {
      const query = getAccountsQuery(filters)
      expect(query.text).toContain('WHERE')
      expect(query.text).toContain('LOWER(address) = ANY')
    })
  })

  describe('when network filter is provided', () => {
    beforeEach(() => {
      filters = { network: Network.MATIC }
    })

    it('should filter by network', () => {
      const query = getAccountsQuery(filters)
      expect(query.text).toContain('WHERE')
      expect(query.text).toContain('network = ANY')
    })
  })

  describe('when multiple filters are provided', () => {
    beforeEach(() => {
      filters = {
        id: '0x1-polygon',
        address: ['0x1'],
        network: Network.MATIC,
        sortBy: AccountSortBy.MOST_SALES,
        first: 10,
        skip: 0
      }
    })

    it('should combine all filters with AND', () => {
      const query = getAccountsQuery(filters)
      expect(query.text).toContain('WHERE')
      expect(query.text).toContain('AND')
    })
  })
})

describe('getAccountsCountQuery', () => {
  let filters: AccountFilters
  describe('when no filters are provided', () => {
    beforeEach(() => {
      filters = {}
    })

    it('should return count query without sorting or pagination', () => {
      const query = getAccountsCountQuery(filters)
      expect(query.text).not.toContain('ORDER BY')
      expect(query.text).not.toContain('LIMIT')
      expect(query.text).not.toContain('OFFSET')
    })
  })

  describe('when filters are provided', () => {
    beforeEach(() => {
      filters = { id: '0x1-polygon', network: Network.MATIC }
    })

    it('should apply filters to count query', () => {
      const query = getAccountsCountQuery(filters)
      expect(query.text).toContain('WHERE')
      expect(query.values).toContain('0x1-polygon')
    })
  })
})

