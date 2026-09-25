import { getTopOwnersHandler } from '../../src/controllers/handlers/top-owners-handler'
import { TopOwnersTimeoutError } from '../../src/ports/owners/errors'
import { TopOwnersSortBy } from '../../src/ports/owners/types'
import { HandlerContextWithPath, StatusCode } from '../../src/types'

const CREATOR = '0x1111111111111111111111111111111111111111'

let context: Pick<HandlerContextWithPath<'owners', '/v1/owners/top'>, 'components' | 'url'>
let fetchTopOwners: jest.Mock

function withQuery(query: string) {
  context = {
    components: { owners: { fetchAndCount: jest.fn(), fetchTopOwners } },
    url: new URL(`http://example.com/v1/owners/top?${query}`)
  }
}

beforeEach(() => {
  fetchTopOwners = jest.fn().mockResolvedValue({ data: [], total: 0 })
})

describe('when getting the top owners of a creator', () => {
  describe('and the parameters are valid', () => {
    beforeEach(() => {
      withQuery(`creator=${CREATOR}&sortBy=spent&orderDirection=asc&first=10&skip=20`)
    })

    it('should pass them through and respond with the page', async () => {
      expect(await getTopOwnersHandler(context)).toEqual({ status: StatusCode.OK, body: { data: [], total: 0 } })
      expect(fetchTopOwners).toHaveBeenCalledWith({
        creator: CREATOR,
        sortBy: TopOwnersSortBy.SPENT,
        orderDirection: 'asc',
        first: 10,
        skip: 20
      })
    })
  })

  describe.each(['', 'creator=nope', `creator=${CREATOR}&sortBy=price`, `creator=${CREATOR}&orderDirection=up`])(
    'and the query is %s',
    query => {
      beforeEach(() => {
        withQuery(query)
      })

      it('should respond with a bad request without querying', async () => {
        expect((await getTopOwnersHandler(context)).status).toBe(StatusCode.BAD_REQUEST)
        expect(fetchTopOwners).not.toHaveBeenCalled()
      })
    }
  )

  describe('and the creator is too large to aggregate in time', () => {
    beforeEach(() => {
      withQuery(`creator=${CREATOR}`)
      fetchTopOwners.mockRejectedValue(new TopOwnersTimeoutError(CREATOR))
    })

    it('should respond with service unavailable', async () => {
      expect((await getTopOwnersHandler(context)).status).toBe(StatusCode.SERVICE_UNAVAILABLE)
    })
  })
})
