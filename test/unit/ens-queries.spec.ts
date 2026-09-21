import { NFTSortBy } from '@dcl/schemas'
import { getENSs } from '../../src/ports/nfts/ensQueries'
import { GetNFTsFilters } from '../../src/ports/nfts/types'

describe('when listing names', () => {
  describe('and searching without asking for a sort', () => {
    it('should order the names by how well they match, so an exact name is never cut off by partial ones', () => {
      const { text, values } = getENSs({ search: 'metatiger', first: 20 } as GetNFTsFilters)

      expect(text).toMatch(/ORDER BY similarity\(nft\.search_text, \$\d+\) DESC, nft\.name ASC, nft\.id ASC/)
      expect(values).toContain('metatiger')
    })
  })

  describe('and searching with a sort', () => {
    it('should keep the sort that was asked for', () => {
      const { text } = getENSs({ search: 'metatiger', sortBy: NFTSortBy.NEWEST, first: 20 } as GetNFTsFilters)

      expect(text).toContain('ORDER BY created_at DESC')
      expect(text).not.toContain('similarity(')
    })
  })

  describe('and not searching', () => {
    it('should impose no order of its own', () => {
      const { text } = getENSs({ first: 20 } as GetNFTsFilters)

      expect(text).not.toContain('similarity(')
    })
  })
})
