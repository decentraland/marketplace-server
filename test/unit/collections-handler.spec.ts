/* eslint-disable @typescript-eslint/unbound-method */
import { URL } from 'url'
import { ChainId, Network } from '@dcl/schemas'
import { getCollectionsHandler } from '../../src/controllers/handlers/collections-handler'
import { Collection, CollectionSortBy } from '../../src/ports/collections/types'
import { HandlerContextWithPath, StatusCode } from '../../src/types'

let collections: Collection[]

describe('when fetching collections', () => {
  let context: Pick<HandlerContextWithPath<'collections', '/v1/collections'>, 'components' | 'url'>

  beforeEach(() => {
    collections = [
      {
        urn: 'urn:decentraland:amoy:collections-v2:0x1096f950841a99f9b961434714d9a08d3d4ebdff',
        creator: '0x2a39d4f68133491f0442496f601cde2a945b6d31',
        name: 'A Cool Collection',
        contractAddress: '0x1096f950841a99f9b961434714d9a08d3d4ebdff',
        createdAt: 1713461367000,
        updatedAt: 1713467453000,
        reviewedAt: 1713467453000,
        isOnSale: false,
        size: 1,
        network: Network.MATIC,
        chainId: ChainId.MATIC_AMOY,
        firstListedAt: null
      }
    ]

    context = {
      url: new URL('http://localhost:3000/v1/collections'),
      components: {
        collections: {
          getCollections: jest.fn().mockResolvedValue({ data: collections, total: 1 })
        }
      }
    }
  })

  describe('and the first parameter is defined in the url', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/collections?first=10')
    })

    it('should fetch collections with the correct first value', async () => {
      const result = await getCollectionsHandler(context)

      expect(context.components.collections.getCollections).toHaveBeenCalledWith(expect.objectContaining({ first: 10 }))
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: collections,
          total: 1
        }
      })
    })
  })

  describe('and the skip parameter is defined in the url', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/collections?skip=5')
    })

    it('should fetch collections with the correct skip value', async () => {
      const result = await getCollectionsHandler(context)

      expect(context.components.collections.getCollections).toHaveBeenCalledWith(expect.objectContaining({ skip: 5 }))
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: collections,
          total: 1
        }
      })
    })
  })

  describe('and neither first nor skip parameters are defined in the url', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/collections')
    })

    it('should fetch collections with undefined first and skip values', async () => {
      const result = await getCollectionsHandler(context)

      expect(context.components.collections.getCollections).toHaveBeenCalledWith(
        expect.objectContaining({ first: undefined, skip: undefined })
      )
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: collections,
          total: 1
        }
      })
    })
  })

  describe('and the sortBy parameter is defined in the url', () => {
    describe('and the sortBy value is valid', () => {
      beforeEach(() => {
        context.url = new URL('http://localhost:3000/v1/collections?sortBy=recently_listed')
      })

      it('should fetch collections with the correct sortBy', async () => {
        const result = await getCollectionsHandler(context)

        expect(context.components.collections.getCollections).toHaveBeenCalledWith(
          expect.objectContaining({ sortBy: CollectionSortBy.RECENTLY_LISTED })
        )
        expect(result).toEqual({
          status: StatusCode.OK,
          body: {
            data: collections,
            total: 1
          }
        })
      })
    })
  })

  describe('and the name parameter is defined in the url', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/collections?name=Cool Collection')
    })

    it('should fetch collections with the correct name', async () => {
      const result = await getCollectionsHandler(context)

      expect(context.components.collections.getCollections).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cool Collection' }))
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: collections,
          total: 1
        }
      })
    })
  })

  describe('and the search parameter is defined in the url', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/collections?search=cool')
    })

    it('should fetch collections with the correct search term', async () => {
      const result = await getCollectionsHandler(context)

      expect(context.components.collections.getCollections).toHaveBeenCalledWith(expect.objectContaining({ search: 'cool' }))
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: collections,
          total: 1
        }
      })
    })
  })

  describe('and the creator parameter is defined in the url', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/collections?creator=0x2a39d4f68133491f0442496f601cde2a945b6d31')
    })

    it('should fetch collections with the correct creator address', async () => {
      const result = await getCollectionsHandler(context)

      expect(context.components.collections.getCollections).toHaveBeenCalledWith(
        expect.objectContaining({ creator: '0x2a39d4f68133491f0442496f601cde2a945b6d31' })
      )
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: collections,
          total: 1
        }
      })
    })
  })

  describe('and the urn parameter is defined in the url', () => {
    beforeEach(() => {
      context.url = new URL(
        'http://localhost:3000/v1/collections?urn=urn:decentraland:amoy:collections-v2:0x1096f950841a99f9b961434714d9a08d3d4ebdff'
      )
    })

    it('should fetch collections with the correct urn', async () => {
      const result = await getCollectionsHandler(context)

      expect(context.components.collections.getCollections).toHaveBeenCalledWith(
        expect.objectContaining({ urn: 'urn:decentraland:amoy:collections-v2:0x1096f950841a99f9b961434714d9a08d3d4ebdff' })
      )
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: collections,
          total: 1
        }
      })
    })
  })

  describe('and the contractAddress parameter is defined in the url', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/collections?contractAddress=0x1096f950841a99f9b961434714d9a08d3d4ebdff')
    })

    it('should fetch collections with the correct contract address', async () => {
      const result = await getCollectionsHandler(context)

      expect(context.components.collections.getCollections).toHaveBeenCalledWith(
        expect.objectContaining({ contractAddress: '0x1096f950841a99f9b961434714d9a08d3d4ebdff' })
      )
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: collections,
          total: 1
        }
      })
    })
  })

  describe('and the isOnSale parameter is defined in the url', () => {
    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/collections?isOnSale=true')
    })

    it('should fetch collections with the correct isOnSale filter', async () => {
      const result = await getCollectionsHandler(context)

      expect(context.components.collections.getCollections).toHaveBeenCalledWith(expect.objectContaining({ isOnSale: true }))
      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: collections,
          total: 1
        }
      })
    })
  })

  describe('and the network parameter is defined in the url', () => {
    describe('and the network is valid', () => {
      beforeEach(() => {
        context.url = new URL(`http://localhost:3000/v1/collections?network=${Network.MATIC}`)
      })

      it('should fetch collections with the correct network', async () => {
        const result = await getCollectionsHandler(context)

        expect(context.components.collections.getCollections).toHaveBeenCalledWith(expect.objectContaining({ network: Network.MATIC }))
        expect(result).toEqual({
          status: StatusCode.OK,
          body: {
            data: collections,
            total: 1
          }
        })
      })
    })
  })

  describe('and there is an error fetching collections', () => {
    let error: Error

    beforeEach(() => {
      context.url = new URL('http://localhost:3000/v1/collections')
      error = new Error('Failed to fetch collections')
      context.components.collections.getCollections = jest.fn().mockRejectedValue(error)
    })

    it('should return response with status INTERNAL_SERVER_ERROR', async () => {
      const result = await getCollectionsHandler(context)

      expect(result).toEqual({
        status: StatusCode.INTERNAL_SERVER_ERROR,
        body: {
          ok: false,
          message: error.message
        }
      })
    })
  })
})
