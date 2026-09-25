import { createSearchSuggestComponent } from '../../src/ports/search-suggest/component'
import { ISearchSuggestComponent } from '../../src/ports/search-suggest/types'

describe('when suggesting for a query', () => {
  let suggest: ISearchSuggestComponent
  let getCatalogItems: jest.Mock
  let query: jest.Mock
  let searchCreators: jest.Mock

  beforeEach(() => {
    getCatalogItems = jest.fn().mockResolvedValue({
      data: [
        { id: 'i1', name: 'Nebula Cape', creator: '0xGALAXY' },
        { id: 'i2', name: 'Galaxy Visor', creator: '0xnobody' }
      ],
      total: 7
    })
    query = jest.fn(async (statement: { text: string }) => {
      if (statement.text.includes('collection_search_words')) {
        return { rows: [{ collection_id: '0xcoll', name: 'Galaxy Crew Drop', creator: '0xCREW', items: '3', sales: '2', score: 1.5 }] }
      }
      return {
        rows: [
          { address: '0xgalaxy', name: 'Galaxy Studio' },
          { address: '0xcrew', name: 'Galaxy Crew' }
        ]
      }
    })
    searchCreators = jest
      .fn()
      .mockResolvedValue({ data: [{ address: '0xgalaxy', name: 'Galaxy Studio', face: null, items: 2, collections: 1 }] })
    suggest = createSearchSuggestComponent({
      dappsDatabase: { query },
      items: { getCatalogItems },
      creatorProfiles: { search: searchCreators },
      manaUsdRate: { getRate: () => 0.25 }
    } as any)
  })

  it('should ask the three sources at once, with the grid feed ranked by relevance and the default page sizes', async () => {
    await suggest.suggest({ search: ' galaxy ' })

    expect(getCatalogItems).toHaveBeenCalledWith(
      { search: 'galaxy', first: 5, skip: 0, sortBy: 'relevance', includeSocialEmotes: false },
      0.25
    )
    const collections = query.mock.calls.find(([s]) => s.text.includes('collection_search_words'))[0]
    expect(collections.values).toEqual(['galaxy', 'galaxy', 'galaxy', 4])
    expect(searchCreators).toHaveBeenCalledWith({ search: 'galaxy', first: 4 })
  })

  it('should resolve creator names once for every item and collection creator, lowercased, and leave unknown ones null', async () => {
    const result = await suggest.suggest({ search: 'galaxy' })

    const names = query.mock.calls.find(([s]) => s.text.includes('COALESCE(name, names[1])'))[0]
    expect(names.values).toEqual([['0xgalaxy', '0xnobody', '0xcrew']])
    expect(result.items.data.map(item => item.creatorName)).toEqual(['Galaxy Studio', null])
    expect(result.items.total).toEqual(7)
    expect(result.collections.data).toEqual([
      { contractAddress: '0xcoll', name: 'Galaxy Crew Drop', creator: '0xCREW', creatorName: 'Galaxy Crew', items: 3, sales: 2 }
    ])
    expect(result.creators.data[0].name).toEqual('Galaxy Studio')
  })

  it('should clamp each section to its bounds', async () => {
    await suggest.suggest({ search: 'galaxy', items: 99, collections: 0, creators: 2 })

    expect(getCatalogItems.mock.calls[0][0].first).toEqual(10)
    expect(query.mock.calls.find(([s]) => s.text.includes('collection_search_words'))[0].values.at(-1)).toEqual(1)
    expect(searchCreators).toHaveBeenCalledWith({ search: 'galaxy', first: 2 })
  })

  it('should answer empty lists, without asking anything, when there is nothing to search for', async () => {
    const result = await suggest.suggest({ search: '   ' })

    expect(result).toEqual({ items: { data: [], total: 0 }, collections: { data: [] }, creators: { data: [] } })
    expect(getCatalogItems).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
    expect(searchCreators).not.toHaveBeenCalled()
  })

  it('should not look names up when no row has a creator', async () => {
    getCatalogItems.mockResolvedValue({ data: [], total: 0 })
    query.mockResolvedValue({ rows: [] })

    await suggest.suggest({ search: 'galaxy' })

    expect(query.mock.calls.some(([s]) => s.text.includes('COALESCE(name, names[1])'))).toBe(false)
  })
})
