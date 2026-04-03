import { SQLStatement } from 'sql-template-strings'
import { Network } from '@dcl/schemas'
import { getAddressFilter, getMaxPriceFilter, getMinPriceFilter, getNetworkFilter } from '../../src/ports/filters'
import { SquidNetwork } from '../../src/types'

describe('getNetworkFilter', () => {
  describe('when network is undefined', () => {
    it('should return null', () => {
      expect(getNetworkFilter(undefined)).toBeNull()
    })
  })

  describe('when network is MATIC', () => {
    let filter: SQLStatement | null

    beforeEach(() => {
      filter = getNetworkFilter(Network.MATIC)
    })

    it('should return a filter containing the network column', () => {
      expect(filter).not.toBeNull()
      expect((filter as SQLStatement).text).toContain('network')
    })

    it('should return a filter with ANY operator', () => {
      expect((filter as SQLStatement).text).toContain('= ANY')
    })

    it('should include MATIC and POLYGON network variants', () => {
      expect((filter as SQLStatement).values).toEqual([[Network.MATIC, SquidNetwork.POLYGON]])
    })
  })

  describe('when network is ETHEREUM', () => {
    let filter: SQLStatement | null

    beforeEach(() => {
      filter = getNetworkFilter(Network.ETHEREUM)
    })

    it('should include ETHEREUM network variants', () => {
      expect(filter).not.toBeNull()
      expect((filter as SQLStatement).values).toEqual([[Network.ETHEREUM, SquidNetwork.ETHEREUM]])
    })
  })

  describe('when a custom column is provided', () => {
    let filter: SQLStatement | null

    beforeEach(() => {
      filter = getNetworkFilter(Network.MATIC, 'c.network')
    })

    it('should use the custom column name', () => {
      expect(filter).not.toBeNull()
      expect((filter as SQLStatement).text).toContain('c.network')
    })
  })
})

describe('getMinPriceFilter', () => {
  describe('when minPrice is undefined', () => {
    it('should return null', () => {
      expect(getMinPriceFilter(undefined)).toBeNull()
    })
  })

  describe('when minPrice is provided', () => {
    let filter: SQLStatement | null

    beforeEach(() => {
      filter = getMinPriceFilter('1000')
    })

    it('should return a >= filter on the price column', () => {
      expect(filter).not.toBeNull()
      expect((filter as SQLStatement).text).toContain('price')
      expect((filter as SQLStatement).text).toContain('>=')
    })

    it('should include the price value as a parameter', () => {
      expect((filter as SQLStatement).values).toEqual(['1000'])
    })
  })

  describe('when a custom column is provided', () => {
    let filter: SQLStatement | null

    beforeEach(() => {
      filter = getMinPriceFilter('1000', 'item.price')
    })

    it('should use the custom column name', () => {
      expect(filter).not.toBeNull()
      expect((filter as SQLStatement).text).toContain('item.price')
    })
  })
})

describe('getMaxPriceFilter', () => {
  describe('when maxPrice is undefined', () => {
    it('should return null', () => {
      expect(getMaxPriceFilter(undefined)).toBeNull()
    })
  })

  describe('when maxPrice is provided', () => {
    let filter: SQLStatement | null

    beforeEach(() => {
      filter = getMaxPriceFilter('5000')
    })

    it('should return a <= filter on the price column', () => {
      expect(filter).not.toBeNull()
      expect((filter as SQLStatement).text).toContain('price')
      expect((filter as SQLStatement).text).toContain('<=')
    })

    it('should include the price value as a parameter', () => {
      expect((filter as SQLStatement).values).toEqual(['5000'])
    })
  })
})

describe('getAddressFilter', () => {
  describe('when address is undefined', () => {
    it('should return null', () => {
      expect(getAddressFilter(undefined, 'owner')).toBeNull()
    })
  })

  describe('when address is provided', () => {
    let filter: SQLStatement | null

    beforeEach(() => {
      filter = getAddressFilter('0xABC123', 'contract_address')
    })

    it('should return a filter on the specified column', () => {
      expect(filter).not.toBeNull()
      expect((filter as SQLStatement).text).toContain('contract_address')
    })

    it('should lowercase the address value', () => {
      expect((filter as SQLStatement).values).toEqual(['0xabc123'])
    })
  })

  describe('when address is already lowercase', () => {
    let filter: SQLStatement | null

    beforeEach(() => {
      filter = getAddressFilter('0xabc123', 'owner')
    })

    it('should keep the address lowercase', () => {
      expect(filter).not.toBeNull()
      expect((filter as SQLStatement).values).toEqual(['0xabc123'])
    })
  })
})
