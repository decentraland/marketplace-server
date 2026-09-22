import { URL } from 'url'
import { createCreatorSearchHandler } from '../../src/controllers/handlers/creator-search-handler'
import { CreatorSearchHit } from '../../src/ports/creator-profiles/types'

describe('when searching creators', () => {
  let search: jest.Mock
  let hits: CreatorSearchHit[]
  const handle = (url: string) =>
    createCreatorSearchHandler({ creatorProfiles: { search, refresh: jest.fn() } })(
      { url: new URL(url) } as unknown as Parameters<ReturnType<typeof createCreatorSearchHandler>>[0],
      jest.fn()
    )

  beforeEach(() => {
    hits = [{ address: '0xa', name: 'Galaxy Studio', face: null, items: 12, collections: 3 }]
    search = jest.fn().mockResolvedValue({ data: hits })
  })

  it('should answer an empty list, not an error, when there is nothing to search for', async () => {
    const response = await handle('http://localhost/v3/catalog/creators/search?search=%20%20')

    expect(response.status).toEqual(200)
    expect(response.body).toEqual({ data: [] })
    expect(search).not.toHaveBeenCalled()
  })

  it('should pass the trimmed query and the requested page size on, and cache the answer briefly', async () => {
    const response = await handle('http://localhost/v3/catalog/creators/search?search=%20galaxy%20&first=3')

    expect(search).toHaveBeenCalledWith({ search: 'galaxy', first: 3 })
    expect(response.status).toEqual(200)
    expect(response.body).toEqual({ data: hits })
    expect(response.headers).toEqual({ 'Cache-Control': 'public,max-age=60,s-maxage=60' })
  })

  it('should fall back to the default page size when none, or a non-number, is given', async () => {
    await handle('http://localhost/v3/catalog/creators/search?search=galaxy&first=lots')

    expect(search).toHaveBeenCalledWith({ search: 'galaxy', first: 4 })
  })
})
