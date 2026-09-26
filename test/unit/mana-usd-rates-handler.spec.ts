import { getManaUsdRatesHandler } from '../../src/controllers/handlers/mana-usd-rates-handler'
import { HandlerContextWithPath, StatusCode } from '../../src/types'

let getDailyRates: jest.Mock
let context: Pick<HandlerContextWithPath<'manaUsdHistory', '/v1/rates/mana-usd'>, 'components' | 'url'>

function withQuery(query: string) {
  context = {
    components: { manaUsdHistory: { getDailyRates, fillMissingDays: jest.fn() } },
    url: new URL(`http://example.com/v1/rates/mana-usd?${query}`)
  }
}

beforeEach(() => {
  getDailyRates = jest.fn().mockResolvedValue([{ day: '2026-09-25', usd: '0.09302823' }])
})

describe('when getting the daily MANA/USD rates', () => {
  describe('and the range is valid', () => {
    beforeEach(() => {
      withQuery('from=1000&to=2000')
    })

    it('should respond with the stored rates', async () => {
      expect(await getManaUsdRatesHandler(context)).toEqual({
        status: StatusCode.OK,
        body: { data: [{ day: '2026-09-25', usd: '0.09302823' }] }
      })
      expect(getDailyRates).toHaveBeenCalledWith(1000, 2000)
    })
  })

  describe.each(['', 'from=1000', 'from=abc&to=2000', 'from=2000&to=1000', `from=0&to=${16 * 366 * 86_400_000}`])(
    'and the query is %s',
    query => {
      beforeEach(() => {
        withQuery(query)
      })

      it('should respond with a bad request without reading', async () => {
        expect((await getManaUsdRatesHandler(context)).status).toBe(StatusCode.BAD_REQUEST)
        expect(getDailyRates).not.toHaveBeenCalled()
      })
    }
  )
})
