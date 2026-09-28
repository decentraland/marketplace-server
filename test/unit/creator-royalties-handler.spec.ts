import { getCreatorRoyaltiesHandler } from '../../src/controllers/handlers/creator-royalties-handler'
import { HandlerContextWithPath, StatusCode } from '../../src/types'

const CREATOR = '0x1111111111111111111111111111111111111111'

let getRoyalties: jest.Mock
let context: Pick<HandlerContextWithPath<'sales', '/v1/sales/royalties'>, 'components' | 'url'>

function withQuery(query: string) {
  context = {
    components: { sales: { getSales: jest.fn(), getSummary: jest.fn(), getRoyalties } },
    url: new URL(`http://example.com/v1/sales/royalties?${query}`)
  }
}

beforeEach(() => {
  getRoyalties = jest.fn().mockResolvedValue({ data: [], total: 0, royaltiesWei: '0' })
})

describe('when getting the royalties of a creator', () => {
  describe('and only the creator is given', () => {
    beforeEach(() => {
      withQuery(`creator=${CREATOR}`)
    })

    it('should read the first page of twenty over all time', async () => {
      expect(await getCreatorRoyaltiesHandler(context)).toEqual({
        status: StatusCode.OK,
        body: { data: [], total: 0, royaltiesWei: '0' }
      })
      expect(getRoyalties).toHaveBeenCalledWith({ creator: CREATOR, first: 20, skip: 0 })
    })
  })

  describe('and a window and a page larger than allowed are given', () => {
    beforeEach(() => {
      withQuery(`creator=${CREATOR}&from=1000&to=2000&first=500&skip=40`)
    })

    it('should pass the window and cap the page size', async () => {
      await getCreatorRoyaltiesHandler(context)

      expect(getRoyalties).toHaveBeenCalledWith({ creator: CREATOR, from: 1000, to: 2000, first: 100, skip: 40 })
    })
  })

  describe.each([
    '',
    'creator=nope',
    `creator=${CREATOR}&from=abc`,
    `creator=${CREATOR}&from=2000&to=1000`,
    `creator=${CREATOR}&to=9007199254740991`,
    `creator=${CREATOR}&first=0`,
    `creator=${CREATOR}&skip=-1`
  ])('and the query is %s', query => {
    beforeEach(() => {
      withQuery(query)
    })

    it('should respond with a bad request without reading', async () => {
      expect((await getCreatorRoyaltiesHandler(context)).status).toBe(StatusCode.BAD_REQUEST)
      expect(getRoyalties).not.toHaveBeenCalled()
    })
  })
})
