/* eslint-disable @typescript-eslint/unbound-method */
import { getOwnersHandler } from '../../src/controllers/handlers/owners-handler'
import { OwnersSortBy } from '../../src/ports/owners/types'
import { HandlerContextWithPath, StatusCode } from '../../src/types'

let context: Pick<HandlerContextWithPath<'owners', '/v1/owners'>, 'components' | 'url'>

describe('getOwnersHandler', () => {
  describe('when get owners call is successful', () => {
    beforeEach(() => {
      context = {
        components: {
          owners: {
            fetchAndCount: jest.fn().mockResolvedValueOnce({ data: [], total: 0 })
          }
        },
        url: new URL('http://example.com/v1/owners?contractAddress=0x123&itemId=0')
      }
    })

    it('should return owners data and total count when successful', async () => {
      const result = await getOwnersHandler(context)

      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: [],
          total: 0
        }
      })
      expect(context.components.owners.fetchAndCount).toHaveBeenCalledWith({
        contractAddress: '0x123',
        itemId: '0',
        orderDirection: 'desc',
        sortBy: OwnersSortBy.ISSUED_ID,
        first: undefined,
        skip: undefined
      })
    })
  })

  describe('when get owners call throws an error', () => {
    beforeEach(() => {
      context = {
        components: {
          owners: {
            fetchAndCount: jest.fn().mockRejectedValue(new Error('Test error'))
          }
        },
        url: new URL('http://example.com/v1/owners?contractAddress=0x123&itemId=0')
      }
    })

    it('should return a bad request error when an error occurs', async () => {
      const result = await getOwnersHandler(context)

      expect(result).toEqual({
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: 'Test error'
        }
      })
      expect(context.components.owners.fetchAndCount).toHaveBeenCalledWith({
        contractAddress: '0x123',
        itemId: '0',
        orderDirection: 'desc',
        sortBy: OwnersSortBy.ISSUED_ID,
        first: undefined,
        skip: undefined
      })
    })
  })

  describe('when missing required parameters', () => {
    beforeEach(() => {
      context = {
        components: {
          owners: {
            fetchAndCount: jest.fn().mockRejectedValue(new Error('itemId and contractAddress are necessary params.'))
          }
        },
        url: new URL('http://example.com/v1/owners')
      }
    })

    it('should return a bad request error when required parameters are missing', async () => {
      const result = await getOwnersHandler(context)

      expect(result).toEqual({
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: 'itemId and contractAddress are necessary params.'
        }
      })
      expect(context.components.owners.fetchAndCount).toHaveBeenCalledWith({
        contractAddress: undefined,
        itemId: undefined,
        orderDirection: 'desc',
        sortBy: OwnersSortBy.ISSUED_ID,
        first: undefined,
        skip: undefined
      })
    })
  })

  describe('when called with sorting parameters', () => {
    beforeEach(() => {
      context = {
        components: {
          owners: {
            fetchAndCount: jest.fn().mockResolvedValue({
              data: [
                { issuedId: '1', ownerId: '0xabc', tokenId: '100' },
                { issuedId: '2', ownerId: '0xdef', tokenId: '101' }
              ],
              total: 2
            })
          }
        },
        url: new URL('http://example.com/v1/owners?contractAddress=0x123&itemId=0&sortBy=issuedId&orderDirection=asc&first=10&skip=0')
      }
    })

    it('should pass all parameters correctly including sorting', async () => {
      const result = await getOwnersHandler(context)

      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          data: [
            { issuedId: '1', ownerId: '0xabc', tokenId: '100' },
            { issuedId: '2', ownerId: '0xdef', tokenId: '101' }
          ],
          total: 2
        }
      })
      expect(context.components.owners.fetchAndCount).toHaveBeenCalledWith({
        contractAddress: '0x123',
        itemId: '0',
        orderDirection: 'asc',
        sortBy: OwnersSortBy.ISSUED_ID,
        first: 10,
        skip: 0
      })
    })
  })
})
