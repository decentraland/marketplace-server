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
    it('should return a filter with MATIC and POLYGON variants', () => {
      const filter = getNetworkFilter(Network.MATIC)
      expect(filter).not.toBeNull()
      expect(filter!.text).toContain('network')
      expect(filter!.text).toContain('= ANY')
      expect(filter!.values).toEqual([[Network.MATIC, SquidNetwork.POLYGON]])
    })
  })

  describe('when network is ETHEREUM', () => {
    it('should return a filter with ETHEREUM variants', () => {
      const filter = getNetworkFilter(Network.ETHEREUM)
      expect(filter).not.toBeNull()
      expect(filter!.values).toEqual([[Network.ETHEREUM, SquidNetwork.ETHEREUM]])
    })
  })

  describe('when a custom column is provided', () => {
    it('should use the custom column name', () => {
      const filter = getNetworkFilter(Network.MATIC, 'c.network')
      expect(filter).not.toBeNull()
      expect(filter!.text).toContain('c.network')
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
    it('should return a >= filter', () => {
      const filter = getMinPriceFilter('1000')
      expect(filter).not.toBeNull()
      expect(filter!.text).toContain('price')
      expect(filter!.text).toContain('>=')
      expect(filter!.values).toEqual(['1000'])
    })
  })

  describe('when a custom column is provided', () => {
    it('should use the custom column name', () => {
      const filter = getMinPriceFilter('1000', 'item.price')
      expect(filter).not.toBeNull()
      expect(filter!.text).toContain('item.price')
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
    it('should return a <= filter', () => {
      const filter = getMaxPriceFilter('5000')
      expect(filter).not.toBeNull()
      expect(filter!.text).toContain('price')
      expect(filter!.text).toContain('<=')
      expect(filter!.values).toEqual(['5000'])
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
    it('should return a filter with lowercased address', () => {
      const filter = getAddressFilter('0xABC123', 'contract_address')
      expect(filter).not.toBeNull()
      expect(filter!.text).toContain('contract_address')
      expect(filter!.values).toEqual(['0xabc123'])
    })
  })

  describe('when address is already lowercase', () => {
    it('should keep it lowercase', () => {
      const filter = getAddressFilter('0xabc123', 'owner')
      expect(filter).not.toBeNull()
      expect(filter!.values).toEqual(['0xabc123'])
    })
  })
})
