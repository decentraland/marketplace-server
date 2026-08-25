import { createTrendingsComponent, TRENDING_WINDOW_DAYS } from '../../src/ports/trendings/component'
import { getDateXDaysAgo } from '../../src/ports/trendings/utils'

/**
 * The look-back window the trending row is computed over.
 *
 * This is a DECISION pinned rather than a behaviour, because the number is the whole thing. It was one day,
 * which on production meant four sales across the entire marketplace — and only those still on sale reach
 * the row, so it rendered two items on a good day and none on a quiet one. The homepage shows its "we are
 * having troubles fetching" copy for a row with nothing in it, so a quiet day read as an outage.
 */
describe('when fetching the trending items', () => {
  let query: jest.Mock
  let getItems: jest.Mock
  let trendings: ReturnType<typeof createTrendingsComponent>

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] })
    getItems = jest.fn().mockResolvedValue({ data: [] })
    trendings = createTrendingsComponent({
      dappsDatabase: { query } as never,
      items: { getItems } as never,
      picks: {} as never
    })
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should count sales over a week, not the single day this used to look back on', async () => {
    await trendings.fetch({})

    // Bound as unix SECONDS, from midnight N days ago — the same helper the component resolves it with.
    const expected = Math.round(getDateXDaysAgo(TRENDING_WINDOW_DAYS).getTime() / 1000)
    expect(query.mock.calls[0][0].values).toContain(expected)
    // And emphatically NOT the day it used to be: that bound is what emptied the row.
    expect(query.mock.calls[0][0].values).not.toContain(Math.round(getDateXDaysAgo(1).getTime() / 1000))
  })

  it('should look back over a week', () => {
    expect(TRENDING_WINDOW_DAYS).toBe(7)
  })
})
