import { Network } from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../src/constants'
import { getCollectionsCountQuery, getCollectionsQuery } from '../../src/ports/contracts/queries'
import { ContractFilters } from '../../src/ports/contracts/types'

describe('getCollectionsWithItemTypesQuery', () => {
  let filters: ContractFilters

  describe('when no filters are provided', () => {
    beforeEach(() => {
      filters = {}
    })

    it('should always filter by is_approved = true', () => {
      const query = getCollectionsQuery(filters)
      expect(query.text).toContain('is_approved = true')
    })

    it('should order by name ASC', () => {
      const query = getCollectionsQuery(filters)
      expect(query.text).toContain('ORDER BY c.name ASC')
    })

    it('should apply default pagination', () => {
      const query = getCollectionsQuery(filters)
      expect(query.text).toContain('LIMIT')
      expect(query.text).toContain('OFFSET')
    })
  })

  describe('when network filter is provided', () => {
    beforeEach(() => {
      filters = { network: Network.MATIC }
    })

    it('should filter by network', () => {
      const query = getCollectionsQuery(filters)
      expect(query.text).toContain('c.network = ANY')
    })
  })

  describe('when pagination filters are provided', () => {
    beforeEach(() => {
      filters = { first: 50, skip: 10 }
    })

    it('should apply LIMIT and OFFSET correctly', () => {
      const query = getCollectionsQuery(filters)
      expect(query.text).toContain('LIMIT')
      expect(query.text).toContain('OFFSET')
      expect(query.values).toContain(50)
      expect(query.values).toContain(10)
    })
  })
})

describe('getCollectionsCountQuery', () => {
  let filters: ContractFilters

  describe('when no filters are provided', () => {
    beforeEach(() => {
      filters = {}
    })

    it('should return count query without pagination or sorting', () => {
      const query = getCollectionsCountQuery(filters)
      expect(query.text).not.toContain('ORDER BY')
      expect(query.text).not.toContain('LIMIT')
      expect(query.text).not.toContain('OFFSET')
    })

    it('should always filter by is_approved = true', () => {
      const query = getCollectionsCountQuery(filters)
      expect(query.text).toContain('is_approved = true')
    })
  })

  describe('when network filter is provided', () => {
    beforeEach(() => {
      filters = { network: Network.MATIC }
    })

    it('should apply network filter to count query', () => {
      const query = getCollectionsCountQuery(filters)
      expect(query.text).toContain('c.network = ANY')
    })
  })
})
