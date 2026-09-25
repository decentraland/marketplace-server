import { URL } from 'url'
import { createSearchSuggestHandler } from '../../src/controllers/handlers/search-suggest-handler'

describe('when asking for suggestions', () => {
  let suggest: jest.Mock
  const answer = { items: { data: [], total: 0 }, collections: { data: [] }, creators: { data: [] } }
  const handle = (url: string) =>
    createSearchSuggestHandler({ searchSuggest: { suggest } })(
      { url: new URL(url) } as unknown as Parameters<ReturnType<typeof createSearchSuggestHandler>>[0],
      jest.fn()
    )

  beforeEach(() => {
    suggest = jest.fn().mockResolvedValue(answer)
  })

  it('should pass the query and each section size on, and cache the answer briefly', async () => {
    const response = await handle('http://localhost/v3/catalog/suggest?search=galaxy&items=3&collections=2&creators=1')

    expect(suggest).toHaveBeenCalledWith({ search: 'galaxy', items: 3, collections: 2, creators: 1 })
    expect(response.status).toEqual(200)
    expect(response.body).toEqual(answer)
    expect(response.headers).toEqual({ 'Cache-Control': 'public,max-age=60,s-maxage=60' })
  })

  it('should leave the sizes to the component when none is given', async () => {
    await handle('http://localhost/v3/catalog/suggest?search=galaxy')

    expect(suggest).toHaveBeenCalledWith({ search: 'galaxy', items: undefined, collections: undefined, creators: undefined })
  })

  it('should ask with an empty query rather than fail when none is given', async () => {
    const response = await handle('http://localhost/v3/catalog/suggest')

    expect(suggest).toHaveBeenCalledWith({ search: '', items: undefined, collections: undefined, creators: undefined })
    expect(response.status).toEqual(200)
  })
})
