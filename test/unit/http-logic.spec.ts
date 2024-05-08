import { URLSearchParams } from 'url'
import { getNumberParameter, getPaginationParams } from '../../src/logic/http'
import { InvalidParameterError } from '../../src/logic/http/errors'

describe('when getting the pagination params', () => {
  describe('and the limit is greater than the max limit', () => {
    it('should return the default limit', () => {
      expect(getPaginationParams(new URLSearchParams({ limit: '200' }))).toEqual({
        limit: 100,
        offset: 0
      })
    })
  })

  describe('and the limit is set to a negative number', () => {
    it('should return the default limit', () => {
      expect(getPaginationParams(new URLSearchParams({ limit: '-100' }))).toEqual({
        limit: 100,
        offset: 0
      })
    })
  })

  describe("and the limit is set to a a value that can't be parsed as a number", () => {
    it('should return the default limit', () => {
      expect(getPaginationParams(new URLSearchParams({ limit: 'notAnInteger' }))).toEqual({
        limit: 100,
        offset: 0
      })
    })
  })

  describe('and the limit is set to a valid value', () => {
    it('should return the value as the limit', () => {
      expect(getPaginationParams(new URLSearchParams({ limit: '10' }))).toEqual({
        limit: 10,
        offset: 0
      })
    })
  })

  describe('and the page is not set', () => {
    it('should return the default page', () => {
      expect(getPaginationParams(new URLSearchParams({}))).toEqual({
        limit: 100,
        offset: 0
      })
    })
  })

  describe("and the page is set to a a value that can't be parsed as a number", () => {
    it('should return the default offset', () => {
      expect(getPaginationParams(new URLSearchParams({ page: 'notAnInteger' }))).toEqual({
        limit: 100,
        offset: 0
      })
    })
  })

  describe('and the page is set to a negative integer', () => {
    it('should return the default offset', () => {
      expect(getPaginationParams(new URLSearchParams({ page: '-20' }))).toEqual({
        limit: 100,
        offset: 0
      })
    })
  })

  describe('and the page is set to a valid value', () => {
    it('should return the value as the page', () => {
      expect(getPaginationParams(new URLSearchParams({ page: '1' }))).toEqual({
        limit: 100,
        offset: 100
      })
    })
  })
})

describe('getNumberParameter', () => {
  let searchParams: URLSearchParams

  describe('when the search parameter is not defined', () => {
    beforeEach(() => {
      searchParams = new URLSearchParams()
    })

    it('should return undefined when value is null', () => {
      expect(getNumberParameter('parameterName', searchParams)).toBe(undefined)
    })
  })

  describe('when the search parameter value is an integer', () => {
    beforeEach(() => {
      searchParams = new URLSearchParams({ parameterName: '12' })
    })

    it('should return parsed number', () => {
      expect(getNumberParameter('parameterName', searchParams)).toBe(12)
    })
  })

  describe('when the search parameter value is not a valid number', () => {
    beforeEach(() => {
      searchParams = new URLSearchParams({ parameterName: 'test' })
    })

    it('should throw InvalidParameterError', () => {
      expect(() => getNumberParameter('parameterName', searchParams)).toThrow(new InvalidParameterError('parameterName', 'test'))
    })
  })
})
