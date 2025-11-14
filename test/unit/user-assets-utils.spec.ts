import { getUserAssetsParams, createPaginatedResponse } from '../../src/controllers/handlers/utils'
import { Params } from '../../src/logic/http/params'
import { StatusCode } from '../../src/types'

describe('User Assets Utils', () => {
  describe('getUserAssetsParams', () => {
    let searchParams: URLSearchParams

    beforeEach(() => {
      searchParams = new URLSearchParams()
    })

    it('should return default values when no params are provided', () => {
      const params = new Params(searchParams)
      const result = getUserAssetsParams(params)

      expect(result).toEqual({
        first: 100,
        skip: 0
      })
    })

    it('should return custom values when params are provided', () => {
      searchParams.set('first', '20')
      searchParams.set('skip', '40')
      const params = new Params(searchParams)
      const result = getUserAssetsParams(params)

      expect(result).toEqual({
        first: 20,
        skip: 40
      })
    })

    it('should use defaults when invalid values are provided', () => {
      searchParams.set('first', 'invalid')
      searchParams.set('skip', 'invalid')
      const params = new Params(searchParams)
      const result = getUserAssetsParams(params)

      expect(result).toEqual({
        first: 100,
        skip: 0
      })
    })
  })

  describe('createPaginatedResponse', () => {
    it('should create a proper paginated response', () => {
      const elements = [{ id: '1' }, { id: '2' }]
      const total = 100
      const first = 20
      const skip = 40

      const result = createPaginatedResponse(elements, total, first, skip)

      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          ok: true,
          data: {
            elements,
            page: 3, // (40 / 20) + 1
            pages: 5, // Math.ceil(100 / 20)
            limit: 20,
            total: 100
          }
        }
      })
    })

    it('should handle first page correctly', () => {
      const elements = [{ id: '1' }]
      const total = 50
      const first = 10
      const skip = 0

      const result = createPaginatedResponse(elements, total, first, skip)

      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          ok: true,
          data: {
            elements,
            page: 1,
            pages: 5,
            limit: 10,
            total: 50
          }
        }
      })
    })

    it('should handle edge case with zero first parameter', () => {
      const elements = [{ id: '1' }]
      const total = 10
      const first = 0
      const skip = 0

      const result = createPaginatedResponse(elements, total, first, skip)

      expect(result).toEqual({
        status: StatusCode.OK,
        body: {
          ok: true,
          data: {
            elements,
            page: 1,
            pages: 10, // Math.ceil(10 / 1)
            limit: 1, // first || 1
            total: 10
          }
        }
      })
    })
  })
})
