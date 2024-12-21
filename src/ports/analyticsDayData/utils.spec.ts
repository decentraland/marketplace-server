import { AnalyticsDayDataFilters } from '@dcl/schemas'
import { getAnalyticsDayDataQuery } from './utils'

describe('getRentalsAnalyticsDayDataQuery', () => {
  let filters: AnalyticsDayDataFilters

  beforeEach(() => {
    filters = {}
  })

  describe('when from is a number > than 0', () => {
    beforeEach(() => {
      filters = {
        from: 1
      }
    })

    it('should add a "where" to the query', () => {
      expect(getAnalyticsDayDataQuery(filters)).toContain('(where:{date_gt: 0})')
    })
  })

  describe('when from is undefined', () => {
    it('should not add a "where" to the query', () => {
      expect(getAnalyticsDayDataQuery(filters)).not.toContain('(where:{date_gt: 0})')
    })
  })

  describe('when from is 0', () => {
    beforeEach(() => {
      filters = {
        from: 0
      }
    })

    it('should not add a "where" to the query', () => {
      expect(getAnalyticsDayDataQuery(filters)).not.toContain('(where:{date_gt: 0})')
    })
  })
})
