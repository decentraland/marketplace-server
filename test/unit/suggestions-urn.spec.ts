import { normalizeItemId, normalizeItemIds, urnToItemId, urnsToItemIds } from '../../src/logic/suggestions/urn'

describe('when parsing a wearable URN', () => {
  describe('and the URN is a Polygon collections-v2 item', () => {
    let urn: string

    beforeEach(() => {
      urn = 'urn:decentraland:matic:collections-v2:0x7cf582b77fb6e1e70308c361b7254040671095dc:3'
    })

    it('should return the contract-itemId pair the neighbour table is keyed on', () => {
      expect(urnToItemId(urn)).toBe('0x7cf582b77fb6e1e70308c361b7254040671095dc-3')
    })
  })

  describe('and the URN is on the Amoy testnet', () => {
    let urn: string

    beforeEach(() => {
      urn = 'urn:decentraland:amoy:collections-v2:0x7CF582B77FB6E1E70308C361B7254040671095DC:12'
    })

    it('should resolve it and lowercase the contract address', () => {
      expect(urnToItemId(urn)).toBe('0x7cf582b77fb6e1e70308c361b7254040671095dc-12')
    })
  })

  describe('and the URN is a base avatar', () => {
    let urn: string

    beforeEach(() => {
      urn = 'urn:decentraland:off-chain:base-avatars:f_sweater'
    })

    it('should return null so a wearable everyone is given never enters the profile', () => {
      expect(urnToItemId(urn)).toBeNull()
    })
  })

  describe('and the URN names a chain that is not Polygon', () => {
    let urn: string

    beforeEach(() => {
      urn = 'urn:decentraland:ethereum:collections-v2:0x7cf582b77fb6e1e70308c361b7254040671095dc:3'
    })

    it('should return null', () => {
      expect(urnToItemId(urn)).toBeNull()
    })
  })

  describe('and the value is not a URN at all', () => {
    it('should return null rather than a partially parsed id', () => {
      expect(urnToItemId('0x7cf582b77fb6e1e70308c361b7254040671095dc-3')).toBeNull()
    })
  })
})

describe('when parsing a list of URNs', () => {
  let urns: string[]

  beforeEach(() => {
    urns = [
      'urn:decentraland:matic:collections-v2:0x7cf582b77fb6e1e70308c361b7254040671095dc:3',
      'urn:decentraland:off-chain:base-avatars:f_sweater',
      'urn:decentraland:matic:collections-v2:0x7cf582b77fb6e1e70308c361b7254040671095dc:3'
    ]
  })

  it('should drop the unresolvable ones and deduplicate the rest', () => {
    expect(urnsToItemIds(urns)).toEqual(['0x7cf582b77fb6e1e70308c361b7254040671095dc-3'])
  })
})

describe('when normalizing a client-supplied item id', () => {
  describe('and the id is well formed', () => {
    it('should lowercase the contract address', () => {
      expect(normalizeItemId('0xABCDEF0123456789ABCDEF0123456789ABCDEF01-7')).toBe('0xabcdef0123456789abcdef0123456789abcdef01-7')
    })
  })

  describe('and the id carries something that is not a number after the dash', () => {
    it('should return null so the value never reaches SQL', () => {
      expect(normalizeItemId('0xabcdef0123456789abcdef0123456789abcdef01-1; DROP TABLE items')).toBeNull()
    })
  })

  describe('and the list is longer than the cap', () => {
    let ids: string[]

    beforeEach(() => {
      ids = Array.from({ length: 30 }, (_, i) => `0xabcdef0123456789abcdef0123456789abcdef01-${i}`)
    })

    it('should keep only as many ids as the cap allows', () => {
      expect(normalizeItemIds(ids, 20)).toHaveLength(20)
    })
  })
})
