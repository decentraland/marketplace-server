import { Network } from '@dcl/schemas'
import { getCollectionsCountQuery, getCollectionsQuery } from '../../src/ports/collections/queries'
import { CollectionSortBy } from '../../src/ports/collections/types'

describe('when querying for collections', () => {
  it('should always filter by is_approved = true', () => {
    const query = getCollectionsQuery({})
    expect(query.text).toContain('is_approved = true')
  })

  describe('and first and skip are defined', () => {
    it('should add pagination to the query', () => {
      const query = getCollectionsQuery({ first: 10, skip: 5 })
      expect(query.text).toContain('LIMIT')
      expect(query.text).toContain('OFFSET')
      expect(query.values).toEqual(expect.arrayContaining([10, 5]))
    })
  })

  describe('and sortBy is defined', () => {
    describe('and sortBy is NEWEST', () => {
      it('should sort by created_at DESC', () => {
        const query = getCollectionsQuery({ sortBy: CollectionSortBy.NEWEST })
        expect(query.text).toContain('ORDER BY created_at DESC')
      })
    })

    describe('and sortBy is RECENTLY_REVIEWED', () => {
      it('should sort by reviewed_at DESC', () => {
        const query = getCollectionsQuery({ sortBy: CollectionSortBy.RECENTLY_REVIEWED })
        expect(query.text).toContain('ORDER BY reviewed_at DESC')
      })
    })

    describe('and sortBy is NAME', () => {
      it('should sort by name ASC', () => {
        const query = getCollectionsQuery({ sortBy: CollectionSortBy.NAME })
        expect(query.text).toContain('ORDER BY name ASC')
      })
    })

    describe('and sortBy is SIZE', () => {
      it('should sort by items_count DESC', () => {
        const query = getCollectionsQuery({ sortBy: CollectionSortBy.SIZE })
        expect(query.text).toContain('ORDER BY items_count DESC')
      })
    })

    describe('and sortBy is RECENTLY_LISTED', () => {
      it('should sort by first_listed_at DESC', () => {
        const query = getCollectionsQuery({ sortBy: CollectionSortBy.RECENTLY_LISTED })
        expect(query.text).toContain('ORDER BY first_listed_at DESC')
      })

      it('should filter out null first_listed_at values', () => {
        const query = getCollectionsQuery({ sortBy: CollectionSortBy.RECENTLY_LISTED })
        expect(query.text).toContain('first_listed_at IS NOT NULL')
      })
    })
  })

  describe('and contractAddress filter is defined', () => {
    it('should add the filter to the query', () => {
      const query = getCollectionsQuery({ contractAddress: '0x1096f950841a99f9b961434714d9a08d3d4ebdff' })
      expect(query.text).toContain('LOWER(id) =')
      expect(query.values).toEqual(expect.arrayContaining(['0x1096f950841a99f9b961434714d9a08d3d4ebdff']))
    })
  })

  describe('and creator filter is defined', () => {
    it('should add the filter to the query', () => {
      const query = getCollectionsQuery({ creator: '0x2a39d4f68133491f0442496f601cde2a945b6d31' })
      expect(query.text).toContain('LOWER(creator) =')
      expect(query.values).toEqual(expect.arrayContaining(['0x2a39d4f68133491f0442496f601cde2a945b6d31']))
    })
  })

  describe('and urn filter is defined', () => {
    it('should add the filter to the query', () => {
      const query = getCollectionsQuery({ urn: 'urn:decentraland:amoy:collections-v2:0x1096f950841a99f9b961434714d9a08d3d4ebdff' })
      expect(query.text).toContain('urn =')
      expect(query.values).toEqual(
        expect.arrayContaining(['urn:decentraland:amoy:collections-v2:0x1096f950841a99f9b961434714d9a08d3d4ebdff'])
      )
    })
  })

  describe('and isOnSale filter is defined', () => {
    describe('and isOnSale is true', () => {
      it('should add the filter to the query', () => {
        const query = getCollectionsQuery({ isOnSale: true })
        expect(query.text).toContain('search_is_store_minter = true')
      })
    })

    describe('and isOnSale is false', () => {
      it('should not add the filter to the query', () => {
        const query = getCollectionsQuery({ isOnSale: false })
        expect(query.text).not.toContain('search_is_store_minter =')
      })
    })
  })

  describe('and name filter is defined', () => {
    it('should add the filter to the query', () => {
      const query = getCollectionsQuery({ name: 'Cool Collection' })
      expect(query.text).toContain('name =')
      expect(query.values).toEqual(expect.arrayContaining(['Cool Collection']))
    })
  })

  describe('and search filter is defined', () => {
    it('should add the LIKE filter to the query', () => {
      const query = getCollectionsQuery({ search: 'cool' })
      expect(query.text).toContain('search_text LIKE')
      expect(query.values).toEqual(expect.arrayContaining(['%cool%']))
    })

    it('should trim and lowercase the search term', () => {
      const query = getCollectionsQuery({ search: '  Cool  ' })
      expect(query.values).toEqual(expect.arrayContaining(['%cool%']))
    })
  })

  describe('and network filter is defined', () => {
    describe('and network is MATIC', () => {
      it('should add the filter to the query', () => {
        const query = getCollectionsQuery({ network: Network.MATIC })
        expect(query.text).toContain('network =')
        expect(query.values).toEqual(expect.arrayContaining([Network.MATIC]))
      })
    })

    describe('and network is ETHEREUM', () => {
      it('should add the filter to the query', () => {
        const query = getCollectionsQuery({ network: Network.ETHEREUM })
        expect(query.text).toContain('network =')
        expect(query.values).toEqual(expect.arrayContaining([Network.ETHEREUM]))
      })
    })
  })

  describe('and multiple filters are defined', () => {
    it('should combine all filters with AND', () => {
      const query = getCollectionsQuery({
        creator: '0x123',
        search: 'test',
        network: Network.MATIC,
        isOnSale: true,
        sortBy: CollectionSortBy.NAME,
        first: 10,
        skip: 5
      })
      expect(query.text).toContain('LOWER(creator) =')
      expect(query.text).toContain('search_text LIKE')
      expect(query.text).toContain('network =')
      expect(query.text).toContain('search_is_store_minter = true')
      expect(query.text).toContain('ORDER BY name ASC')
      expect(query.text).toContain('LIMIT')
      expect(query.text).toContain('OFFSET')
    })
  })
})

describe('when querying for collections count', () => {
  it('should always filter by is_approved = true', () => {
    const query = getCollectionsCountQuery({})
    expect(query.text).toContain('is_approved = true')
  })

  it('should not include pagination in count query', () => {
    const query = getCollectionsCountQuery({ first: 10, skip: 5 })
    expect(query.text).not.toContain('LIMIT')
    expect(query.text).not.toContain('OFFSET')
  })

  it('should not include sorting in count query', () => {
    const query = getCollectionsCountQuery({ sortBy: CollectionSortBy.NAME })
    expect(query.text).not.toContain('ORDER BY')
  })

  describe('and filters are defined', () => {
    it('should apply the same filters as the main query', () => {
      const query = getCollectionsCountQuery({
        creator: '0x123',
        search: 'test',
        network: Network.MATIC
      })
      expect(query.text).toContain('LOWER(creator) =')
      expect(query.text).toContain('search_text LIKE')
      expect(query.text).toContain('network =')
    })
  })
})

