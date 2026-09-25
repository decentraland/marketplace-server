import { TopOwner, TopOwnersSortBy } from '../../src/ports/owners/types'
import { fromTopOwnerDBRow, rankTopOwners, TOP_OWNERS_MAX_LIMIT } from '../../src/ports/owners/utils'

function owner(address: string, overrides: Partial<TopOwner> = {}): TopOwner {
  return { address, nfts: 1, items: 1, collections: 1, lastAcquiredAt: 1000, spentWei: '0', ...overrides }
}

describe('when mapping a top owner row', () => {
  it('should convert the counts to numbers and the acquisition time to milliseconds', () => {
    expect(fromTopOwnerDBRow({ owner: '0xa', nfts: '3', items: '2', collections: '1', last_at: '1700000000', spent: '5' })).toEqual({
      address: '0xa',
      nfts: 3,
      items: 2,
      collections: 1,
      lastAcquiredAt: 1_700_000_000_000,
      spentWei: '5'
    })
  })
})

describe('when ranking the owners of a creator', () => {
  let owners: TopOwner[]

  beforeEach(() => {
    owners = [
      owner('0xb', { nfts: 2, spentWei: '900000000000000000000' }),
      owner('0xa', { nfts: 5, spentWei: '10' }),
      owner('0xc', { nfts: 2, lastAcquiredAt: 5000, spentWei: '90000000000000000000000' })
    ]
  })

  describe('and no sort is given', () => {
    it('should put the owner holding the most first, breaking ties by the most recent acquisition', () => {
      expect(rankTopOwners(owners, {}).data.map(o => o.address)).toEqual(['0xa', '0xc', '0xb'])
    })
  })

  describe('and it is sorted by what they spent', () => {
    it('should compare the wei amounts exactly rather than as floating point', () => {
      expect(rankTopOwners(owners, { sortBy: TopOwnersSortBy.SPENT }).data.map(o => o.address)).toEqual(['0xc', '0xb', '0xa'])
    })
  })

  describe('and it is sorted ascending', () => {
    it('should put the smallest first', () => {
      expect(rankTopOwners(owners, { sortBy: TopOwnersSortBy.NFTS, orderDirection: 'asc' }).data[0].nfts).toBe(2)
    })
  })

  describe('and a page is asked for', () => {
    it('should return that page and the total', () => {
      expect(rankTopOwners(owners, { first: 1, skip: 1 })).toEqual({ data: [owners[2]], total: 3 })
    })
  })

  describe('and the page size is above the maximum', () => {
    it('should cap it', () => {
      const many = Array.from({ length: TOP_OWNERS_MAX_LIMIT + 5 }, (_, i) => owner(`0x${i}`))

      expect(rankTopOwners(many, { first: 1000 }).data).toHaveLength(TOP_OWNERS_MAX_LIMIT)
    })
  })
})
