import * as authorizationMiddleware from 'decentraland-crypto-middleware'
import { fromDBPickStatsToPickStats, TPick } from '../../src/adapters/picks'
import {
  getPicksByItemIdHandler,
  getPickStatsHandler,
  getPickStatsOfItemHandler,
  pickAndUnpickInBulkHandler
} from '../../src/controllers/handlers/favorites/picks-handlers'
import { ListsNotFoundError } from '../../src/ports/favorites/lists/errors'
import { DBGetFilteredPicksWithCount, DBPickStats, PickUnpickInBulkBody, PickUnpickInBulkResponse } from '../../src/ports/favorites/picks'
import { ItemNotFoundError } from '../../src/ports/items/errors'
import { AppComponents, HandlerContextWithPath, StatusCode } from '../../src/types'
import { createTestPicksComponent } from '../components'

let url: URL
let userAddress: string
let verification: authorizationMiddleware.DecentralandSignatureData | undefined
let components: Pick<AppComponents, 'picks'>
let itemId: string
let pickStats: DBPickStats
let getPicksStatsMock: jest.Mock

beforeEach(() => {
  userAddress = '0x58ae4c4cb2b35632ea98f214a2918b171f1e1247'
  verification = { auth: userAddress, authMetadata: {} }
  itemId = '0x0023693cd7f5ac9931ce9fc482c5c328198bc819-1'
  pickStats = {
    picked_by_user: true,
    item_id: itemId,
    count: '1000'
  }

  getPicksStatsMock = jest.fn()
  components = {
    picks: createTestPicksComponent({ getPicksStats: getPicksStatsMock })
  }
})

describe('when getting the stats of a pick', () => {
  let request: HandlerContextWithPath<'picks', '/v1/picks/:itemId/stats'>['request']
  let params: HandlerContextWithPath<'picks', '/v1/picks/:itemId/stats'>['params']

  beforeEach(() => {
    request = {} as HandlerContextWithPath<'picks', '/v1/picks/:itemId/stats'>['request']
    params = { itemId }
    url = new URL(`http://localhost/v1/picks/${itemId}/stats`)
  })

  describe("and the power parameter is set and it's not a number", () => {
    beforeEach(() => {
      url = new URL(`http://localhost/v1/picks/${itemId}/stats?power=anInvalidValue`)
    })

    it('should return a bad request response', () => {
      return expect(getPickStatsOfItemHandler({ params, components, url, request, verification })).resolves.toEqual({
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: 'The value of the power parameter is invalid: anInvalidValue'
        }
      })
    })
  })

  describe('and the power parameter is set as a number', () => {
    beforeEach(() => {
      url = new URL(`http://localhost/v1/picks/${itemId}/stats?power=200`)
      getPicksStatsMock.mockResolvedValueOnce([pickStats])
    })

    it('should request the stats using the power parameter', async () => {
      await getPickStatsOfItemHandler({ params, components, url, request, verification })
      expect(getPicksStatsMock).toHaveBeenCalledWith([itemId], expect.objectContaining({ power: 200 }))
    })
  })

  describe('and the power parameter is not set', () => {
    beforeEach(() => {
      url = new URL(`http://localhost/v1/picks/${itemId}/stats`)
      getPicksStatsMock.mockResolvedValueOnce([pickStats])
    })

    it('should request the stats without the power parameter', async () => {
      await getPickStatsOfItemHandler({ params, components, url, request, verification })
      expect(getPicksStatsMock).toHaveBeenCalledWith([itemId], expect.objectContaining({ power: undefined }))
    })
  })

  describe('and the request is authenticated with a signature', () => {
    beforeEach(() => {
      getPicksStatsMock.mockResolvedValueOnce([pickStats])
    })

    it('should request the stats using the user address of the authenticated user', async () => {
      await getPickStatsOfItemHandler({ params, components, url, request, verification })
      expect(getPicksStatsMock).toHaveBeenCalledWith([itemId], expect.objectContaining({ userAddress }))
    })
  })

  describe('and the request is not authenticated with a signature', () => {
    beforeEach(() => {
      getPicksStatsMock.mockResolvedValueOnce([pickStats])
    })

    it('should request the stats without a user address', async () => {
      await getPickStatsOfItemHandler({ params, components, url, request, verification: undefined })
      expect(getPicksStatsMock).toHaveBeenCalledWith([itemId], expect.objectContaining({ userAddress: undefined }))
    })
  })

  describe('and getting the pick stats fails', () => {
    let error: Error

    beforeEach(() => {
      error = new Error('anError')
      getPicksStatsMock.mockRejectedValueOnce(error)
    })

    it('should propagate the error', () => {
      return expect(getPickStatsOfItemHandler({ params, components, url, request, verification })).rejects.toEqual(error)
    })
  })

  describe('and the request is successful', () => {
    beforeEach(() => {
      getPicksStatsMock.mockResolvedValueOnce([pickStats])
    })

    it('should return an ok response with the stats', () => {
      return expect(getPickStatsOfItemHandler({ params, components, url, request, verification })).resolves.toEqual({
        status: StatusCode.OK,
        body: {
          ok: true,
          data: fromDBPickStatsToPickStats(pickStats)
        }
      })
    })
  })
})

describe('when getting the stats of picks', () => {
  beforeEach(() => {
    url = new URL('http://localhost/v1/picks/stats')
  })

  describe('and there are no item ids sent as query parameters', () => {
    it('should return a bad request response', () => {
      return expect(getPickStatsHandler({ components, url })).resolves.toEqual({
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: 'The request must include at least one item id.'
        }
      })
    })
  })

  describe("and the power parameter is set and it's not a number", () => {
    beforeEach(() => {
      url = new URL(`http://localhost/v1/picks/stats?power=anInvalidValue&itemId=${itemId}`)
    })

    it('should return a bad request response', () => {
      return expect(getPickStatsHandler({ components, url })).resolves.toEqual({
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: 'The value of the power parameter is invalid: anInvalidValue'
        }
      })
    })
  })

  describe('and the power parameter is set as a number', () => {
    beforeEach(() => {
      url = new URL(`http://localhost/v1/picks/stats?power=200&itemId=${itemId}`)
      getPicksStatsMock.mockResolvedValueOnce([pickStats])
    })

    it('should request the stats using the power parameter', async () => {
      await getPickStatsHandler({ components, url })
      expect(getPicksStatsMock).toHaveBeenCalledWith([itemId], expect.objectContaining({ power: 200 }))
    })
  })

  describe('and the power parameter is not set', () => {
    beforeEach(() => {
      url = new URL(`http://localhost/v1/picks/stats?itemId=${itemId}`)
      getPicksStatsMock.mockResolvedValueOnce([pickStats])
    })

    it('should request the stats without the power parameter', async () => {
      await getPickStatsHandler({ components, url })
      expect(getPicksStatsMock).toHaveBeenCalledWith([itemId], expect.objectContaining({ power: undefined }))
    })
  })

  describe('and the checkingUserAddress parameter is set', () => {
    beforeEach(() => {
      getPicksStatsMock.mockResolvedValueOnce([pickStats])
    })

    describe('and the address is not an ethereum address', () => {
      beforeEach(() => {
        url = new URL(`http://localhost/v1/picks/stats?checkingUserAddress=somethingNotAddress&itemId=${itemId}`)
      })

      it('should return a bad request response', () => {
        return expect(getPickStatsHandler({ components, url })).resolves.toEqual({
          status: StatusCode.BAD_REQUEST,
          body: {
            ok: false,
            message: 'The checking user address parameter must be an Ethereum Address.'
          }
        })
      })
    })

    describe('and the address is an ethereum address', () => {
      beforeEach(() => {
        url = new URL(`http://localhost/v1/picks/stats?checkingUserAddress=${userAddress}&itemId=${itemId}`)
      })

      it('should request the stats with the user address', async () => {
        await getPickStatsHandler({ components, url })
        expect(getPicksStatsMock).toHaveBeenCalledWith([itemId], expect.objectContaining({ power: undefined, userAddress }))
      })
    })
  })

  describe('and the checkingUserAddress parameter is not set', () => {
    beforeEach(() => {
      url = new URL(`http://localhost/v1/picks/stats?itemId=${itemId}`)
      getPicksStatsMock.mockResolvedValueOnce([pickStats])
    })

    it('should request the stats without the user address parameter', async () => {
      await getPickStatsHandler({ components, url })
      expect(getPicksStatsMock).toHaveBeenCalledWith([itemId], expect.objectContaining({ userAddress: undefined }))
    })
  })

  describe('and getting the pick stats fails', () => {
    let error: Error

    beforeEach(() => {
      error = new Error('anError')
      url = new URL(`http://localhost/v1/picks/stats?itemId=${itemId}`)
      getPicksStatsMock.mockRejectedValueOnce(error)
    })

    it('should propagate the error', () => {
      return expect(getPickStatsHandler({ components, url })).rejects.toEqual(error)
    })
  })

  describe('and the request is successful', () => {
    beforeEach(() => {
      url = new URL(`http://localhost/v1/picks/stats?itemId=${itemId}`)
      getPicksStatsMock.mockResolvedValueOnce([pickStats])
    })

    it('should return an ok response with the stats', () => {
      return expect(getPickStatsHandler({ components, url })).resolves.toEqual({
        status: StatusCode.OK,
        body: {
          ok: true,
          data: [fromDBPickStatsToPickStats(pickStats)]
        }
      })
    })
  })
})

describe('when getting the picks for an item', () => {
  let url: URL
  let getPicksByItemIdMock: jest.Mock
  let request: HandlerContextWithPath<'picks', '/v1/picks/:itemId'>['request']
  let params: HandlerContextWithPath<'picks', '/v1/picks/:itemId'>['params']
  let userAddress: string
  let anotherUserAddress: string
  let dbPicksByItemId: DBGetFilteredPicksWithCount[]
  let picks: Pick<TPick, 'userAddress'>[]

  beforeEach(() => {
    itemId = 'item-id'
    getPicksByItemIdMock = jest.fn()
    components = {
      picks: createTestPicksComponent({
        getPicksByItemId: getPicksByItemIdMock
      })
    }
    request = {} as HandlerContextWithPath<'lists', '/v1/picks/:itemId'>['request']
    url = new URL(`http://localhost/v1/picks/${itemId}`)
    params = { itemId }
    userAddress = '0x687abb534BD927284F84b03d43f33dF0E5C91D21'
    anotherUserAddress = '0x45abb534BD927284F84b03d43f33dF0E5C91C21f'

    dbPicksByItemId = [
      {
        item_id: '1',
        user_address: userAddress,
        list_id: 'e96df126-f5bf-4311-94d8-6e261f368bb2',
        created_at: new Date(),
        picks_count: '2'
      },
      {
        item_id: '1',
        user_address: anotherUserAddress,
        list_id: 'f96df126-f5bf-4311-94d8-6e261f368bb4',
        created_at: new Date(),
        picks_count: '2'
      }
    ]
  })

  describe('and the process to get the picks fails', () => {
    let error: Error

    beforeEach(() => {
      error = new Error('anError')
      getPicksByItemIdMock.mockRejectedValueOnce(error)
    })

    it('should propagate the error', () => {
      return expect(getPicksByItemIdHandler({ params, components, url, request, verification })).rejects.toEqual(error)
    })
  })

  describe("and the power parameter is set and it's not a number", () => {
    beforeEach(() => {
      url = new URL(`http://localhost/v1/lists/${itemId}/picks?power=anInvalidValue`)
    })

    it('should return a bad request response', () => {
      return expect(getPicksByItemIdHandler({ params, components, url, request, verification })).resolves.toEqual({
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: 'The value of the power parameter is invalid: anInvalidValue'
        }
      })
    })
  })

  describe('and the power parameter is set as a number', () => {
    beforeEach(() => {
      url = new URL(`http://localhost/v1/lists/${itemId}/picks?power=200`)
      getPicksByItemIdMock.mockResolvedValueOnce([])
    })

    it('should request the picks by item id using the power parameter', async () => {
      await getPicksByItemIdHandler({ params, components, url, request, verification })
      expect(getPicksByItemIdMock).toHaveBeenCalledWith(itemId, expect.objectContaining({ power: 200 }))
    })
  })

  describe('and the power parameter is not set', () => {
    beforeEach(() => {
      url = new URL(`http://localhost/v1/lists/${itemId}/picks`)
      getPicksByItemIdMock.mockResolvedValueOnce([])
    })

    it('should request the picks by item id without the power parameter', async () => {
      await getPicksByItemIdHandler({ params, components, url, request, verification })
      expect(getPicksByItemIdMock).toHaveBeenCalledWith(itemId, expect.objectContaining({ power: undefined }))
    })
  })

  describe('and the request is authenticated with a signature', () => {
    beforeEach(() => {
      getPicksByItemIdMock.mockResolvedValueOnce(dbPicksByItemId)
    })

    it('should request the picks by item id using the user address of the authenticated user', async () => {
      await getPicksByItemIdHandler({ params, components, url, request, verification })
      expect(getPicksByItemIdMock).toHaveBeenCalledWith(itemId, expect.objectContaining({ userAddress: verification?.auth }))
    })
  })

  describe('and the request is not authenticated with a signature', () => {
    beforeEach(() => {
      getPicksByItemIdMock.mockResolvedValueOnce(dbPicksByItemId)
    })

    it('should request the picks by item id without a user address', async () => {
      await getPicksByItemIdHandler({ params, components, url, request, verification: undefined })
      expect(getPicksByItemIdMock).toHaveBeenCalledWith(itemId, expect.objectContaining({ userAddress: undefined }))
    })
  })

  describe('and the process to get the picks is successful', () => {
    describe('when not using pagination parameters', () => {
      beforeEach(() => {
        picks = [{ userAddress }, { userAddress: anotherUserAddress }]
        getPicksByItemIdMock.mockResolvedValueOnce(dbPicksByItemId)
      })

      it('should return a response with an ok status code and the picks using the default values of limit and page', () => {
        return expect(getPicksByItemIdHandler({ url, components, request, params })).resolves.toEqual({
          status: StatusCode.OK,
          body: {
            ok: true,
            data: {
              results: picks,
              total: 2,
              page: 0,
              pages: 1,
              limit: 100
            }
          }
        })
      })
    })

    describe('when using the pagination parameters', () => {
      describe('when the limit is 1 and the page is 0', () => {
        beforeEach(() => {
          url = new URL(`http://localhost/v1/lists/${itemId}/picks?limit=1&page=0`)
          picks = [{ userAddress }]
          getPicksByItemIdMock.mockResolvedValueOnce([dbPicksByItemId[0]])
        })

        it('should return an array with the first pick', () => {
          return expect(getPicksByItemIdHandler({ url, components, request, params, verification })).resolves.toEqual({
            status: StatusCode.OK,
            body: {
              ok: true,
              data: {
                results: picks,
                total: 2,
                page: 0,
                pages: 2,
                limit: 1
              }
            }
          })
        })
      })

      describe('limit is 1 and the page is 1', () => {
        beforeEach(() => {
          url = new URL(`http://localhost/v1/lists/${itemId}/picks?limit=1&page=1`)
          picks = [{ userAddress: anotherUserAddress }]
          getPicksByItemIdMock.mockResolvedValueOnce([dbPicksByItemId[1]])
        })

        it('should return an array with the second pick', () => {
          return expect(getPicksByItemIdHandler({ url, components, request, params, verification })).resolves.toEqual({
            status: StatusCode.OK,
            body: {
              ok: true,
              data: {
                results: picks,
                total: 2,
                page: 1,
                pages: 2,
                limit: 1
              }
            }
          })
        })
      })
    })
  })
})

describe('when picking or unpicking an item for/from multiple lists', () => {
  let pickAndUnpickInBulkMock: jest.Mock
  let request: HandlerContextWithPath<'picks', '/v1/picks/:itemId'>['request']
  let params: HandlerContextWithPath<'picks', '/v1/picks/:itemId'>['params']
  let jsonMock: jest.Mock

  beforeEach(() => {
    pickAndUnpickInBulkMock = jest.fn()
    jsonMock = jest.fn()
    components = {
      picks: createTestPicksComponent({
        pickAndUnpickInBulk: pickAndUnpickInBulkMock,
        getPicksStats: getPicksStatsMock
      })
    }
    request = { json: jsonMock } as unknown as HandlerContextWithPath<'lists', '/v1/picks/:itemId'>['request']
    params = { itemId }
  })

  describe('and the request is not authenticated', () => {
    beforeEach(() => {
      verification = undefined
    })

    it('should return an unauthorized response', () => {
      return expect(
        pickAndUnpickInBulkHandler({
          components,
          verification,
          request,
          params
        })
      ).resolves.toEqual({
        status: StatusCode.UNAUTHORIZED,
        body: {
          ok: false,
          message: 'Unauthorized',
          data: undefined
        }
      })
    })
  })

  describe('and the user is trying to pick and unpick to and from a list at the same time', () => {
    beforeEach(() => {
      jsonMock.mockResolvedValueOnce({
        pickedFor: ['list-id', 'repeated-list-id'],
        unpickedFrom: ['repeated-list-id']
      } as PickUnpickInBulkBody)
    })

    it('should return a bad request response', () => {
      return expect(
        pickAndUnpickInBulkHandler({
          components,
          verification,
          request,
          params
        })
      ).resolves.toEqual({
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: 'The item cannot be be picked and unpicked from a list at the same time.',
          data: undefined
        }
      })
    })
  })

  describe('and the process fails with a lists not found error', () => {
    const pickedFor = ['list-id', 'another-list-id']
    const unpickedFrom = ['a-different-list-id']
    beforeEach(() => {
      jsonMock.mockResolvedValueOnce({ pickedFor, unpickedFrom })
      pickAndUnpickInBulkMock.mockRejectedValueOnce(new ListsNotFoundError([...pickedFor, ...unpickedFrom]))
    })

    it('should return a response with a message saying that there are some lists inaccessible to the user and the 404 status code', () => {
      return expect(pickAndUnpickInBulkHandler({ components, verification, request, params })).resolves.toEqual({
        status: StatusCode.NOT_FOUND,
        body: {
          ok: false,
          message: 'Some lists were not found.',
          data: { listIds: [...pickedFor, ...unpickedFrom] }
        }
      })
    })
  })

  describe('and the process fails with a item not found error', () => {
    beforeEach(() => {
      jsonMock.mockResolvedValueOnce({})
      pickAndUnpickInBulkMock.mockRejectedValueOnce(new ItemNotFoundError(itemId))
    })

    it('should return a response with a message saying that the item does not exist and the 404 status code', () => {
      return expect(pickAndUnpickInBulkHandler({ components, verification, request, params })).resolves.toEqual({
        status: StatusCode.NOT_FOUND,
        body: {
          ok: false,
          message: "The item trying to get saved doesn't exist.",
          data: {
            itemId
          }
        }
      })
    })
  })

  describe('and the process fails with an unknown error', () => {
    const error = new Error('anError')

    beforeEach(() => {
      jsonMock.mockResolvedValueOnce({})
      pickAndUnpickInBulkMock.mockRejectedValueOnce(error)
    })

    it('should return a response with a message saying that the item does not exist and the 404 status code', () => {
      return expect(pickAndUnpickInBulkHandler({ components, verification, request, params })).rejects.toEqual(error)
    })
  })

  describe('and the process is successful', () => {
    const unpickedFrom = ['a-different-list-id']

    describe('and the user is adding the item to some lists through the pickedFor property of the body', () => {
      const pickedFor = ['list-id', 'another-list-id']

      beforeEach(() => {
        jsonMock.mockResolvedValueOnce({ pickedFor, unpickedFrom })
        pickAndUnpickInBulkMock.mockResolvedValueOnce([])
      })

      it('should return an ok response with the flag "pickedByUser" in true because the user just added the item to some lists', () => {
        return expect(pickAndUnpickInBulkHandler({ params, components, request, verification })).resolves.toEqual({
          status: StatusCode.OK,
          body: {
            ok: true,
            data: {
              pickedByUser: true
            } as PickUnpickInBulkResponse
          }
        })
      })
    })

    describe('and the user is only removing the item from some lists through the unpickedFrom property of the body', () => {
      beforeEach(() => {
        jsonMock.mockResolvedValueOnce({ unpickedFrom })
        pickAndUnpickInBulkMock.mockResolvedValueOnce([])
      })

      describe('and the user does not have more list in which has added the item', () => {
        beforeEach(() => {
          getPicksStatsMock.mockResolvedValueOnce([{ picked_by_user: false } as DBPickStats])
        })

        it('should return an ok response with the flag "pickedByUser" in false in the past', () => {
          return expect(pickAndUnpickInBulkHandler({ params, components, request, verification })).resolves.toEqual({
            status: StatusCode.OK,
            body: {
              ok: true,
              data: {
                pickedByUser: false
              } as PickUnpickInBulkResponse
            }
          })
        })
      })

      describe('and the user has more list in which has added the item in the past', () => {
        beforeEach(() => {
          getPicksStatsMock.mockResolvedValueOnce([{ picked_by_user: true } as DBPickStats])
        })

        it('should return an ok response with the flag "pickedByUser" in true', () => {
          return expect(pickAndUnpickInBulkHandler({ params, components, request, verification })).resolves.toEqual({
            status: StatusCode.OK,
            body: {
              ok: true,
              data: {
                pickedByUser: true
              } as PickUnpickInBulkResponse
            }
          })
        })
      })
    })
  })
})
