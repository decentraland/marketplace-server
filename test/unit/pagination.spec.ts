import { extractCount, getLimitAndOffsetStatement } from '../../src/ports/pagination'

describe('getLimitAndOffsetStatement', () => {
  describe('when no params are provided', () => {
    it('should use default limit of 1000 and offset of 0', () => {
      const statement = getLimitAndOffsetStatement({})
      expect(statement.text).toContain('LIMIT')
      expect(statement.text).toContain('OFFSET')
      expect(statement.values).toEqual([1000, 0])
    })
  })

  describe('when first and skip are provided', () => {
    it('should use the provided values', () => {
      const statement = getLimitAndOffsetStatement({ first: 50, skip: 10 })
      expect(statement.values).toEqual([50, 10])
    })
  })

  describe('when only first is provided', () => {
    it('should use 0 as the default offset', () => {
      const statement = getLimitAndOffsetStatement({ first: 25 })
      expect(statement.values).toEqual([25, 0])
    })
  })

  describe('when only skip is provided', () => {
    it('should use the default limit', () => {
      const statement = getLimitAndOffsetStatement({ skip: 5 })
      expect(statement.values).toEqual([1000, 5])
    })
  })

  describe('when a custom defaultLimit is provided', () => {
    it('should use the custom default instead of 1000', () => {
      const statement = getLimitAndOffsetStatement({}, { defaultLimit: 100 })
      expect(statement.values).toEqual([100, 0])
    })
  })

  describe('when a maxLimit is provided', () => {
    describe('and first exceeds the maxLimit', () => {
      it('should cap the limit to maxLimit', () => {
        const statement = getLimitAndOffsetStatement({ first: 5000 }, { maxLimit: 1000 })
        expect(statement.values).toEqual([1000, 0])
      })
    })

    describe('and first is within the maxLimit', () => {
      it('should use the provided first value', () => {
        const statement = getLimitAndOffsetStatement({ first: 50 }, { maxLimit: 1000 })
        expect(statement.values).toEqual([50, 0])
      })
    })
  })

  describe('when both defaultLimit and maxLimit are provided', () => {
    describe('and no first is given', () => {
      it('should use the defaultLimit', () => {
        const statement = getLimitAndOffsetStatement({}, { defaultLimit: 100, maxLimit: 500 })
        expect(statement.values).toEqual([100, 0])
      })
    })
  })
})

describe('extractCount', () => {
  describe('when the result has a count row', () => {
    it('should return the numeric count value', () => {
      expect(extractCount({ rows: [{ count: '42' }] })).toBe(42)
    })
  })

  describe('when the result has zero rows', () => {
    it('should return 0', () => {
      expect(extractCount({ rows: [] })).toBe(0)
    })
  })

  describe('when the count value is "0"', () => {
    it('should return 0', () => {
      expect(extractCount({ rows: [{ count: '0' }] })).toBe(0)
    })
  })

  describe('when the rows array is undefined', () => {
    it('should return 0', () => {
      expect(extractCount({ rows: undefined } as any)).toBe(0)
    })
  })

  describe('when the count property is missing from the row', () => {
    it('should return 0', () => {
      expect(extractCount({ rows: [{}] } as any)).toBe(0)
    })
  })
})
