import { COLLECTION_SUGGEST_DEFAULT_LIMIT, CollectionSearchRow, getCollectionSearchQuery } from '../../logic/catalog/collection-search'
import { getCreatorDisplayNamesQuery } from '../../logic/catalog/creator-profiles'
import { SEARCH_QUERY_MAX_LENGTH } from '../../logic/catalog/search-normalization'
import { AppComponents } from '../../types'
import { clampCount } from '../shop-catalog/component'
import {
  ISearchSuggestComponent,
  SUGGEST_CREATORS_DEFAULT_LIMIT,
  SUGGEST_ITEMS_DEFAULT_LIMIT,
  SUGGEST_SECTION_MAX_LIMIT,
  SuggestFilters,
  SuggestResponse
} from './types'

const EMPTY: SuggestResponse = { items: { data: [], total: 0 }, collections: { data: [] }, creators: { data: [] } }

/**
 * Everything the search dropdown shows for a query, in one answer: the items the grid would list first,
 * the collections and the creators whose names match, each row already carrying what to call its
 * creator. It replaces three requests plus a profile lookup per row — up to a dozen calls a keystroke.
 */
export function createSearchSuggestComponent(
  components: Pick<AppComponents, 'dappsDatabase' | 'items' | 'creatorProfiles' | 'manaUsdRate'>
): ISearchSuggestComponent {
  const { dappsDatabase, items, creatorProfiles, manaUsdRate } = components

  async function suggest(filters: SuggestFilters): Promise<SuggestResponse> {
    const search = filters.search.trim().slice(0, SEARCH_QUERY_MAX_LENGTH)
    if (!search) return EMPTY

    const [catalog, collections, creators] = await Promise.all([
      // Exactly what /v3/catalog/items answers for the same query: the suggestion and the grid it opens
      // must agree on what matches and on the total.
      items.getCatalogItems(
        {
          search,
          first: clampCount(filters.items, SUGGEST_ITEMS_DEFAULT_LIMIT, 1, SUGGEST_SECTION_MAX_LIMIT),
          skip: 0,
          sortBy: 'relevance',
          includeSocialEmotes: false
        },
        manaUsdRate.getRate()
      ),
      dappsDatabase.query<CollectionSearchRow>(
        getCollectionSearchQuery(search, clampCount(filters.collections, COLLECTION_SUGGEST_DEFAULT_LIMIT, 1, SUGGEST_SECTION_MAX_LIMIT))
      ),
      creatorProfiles.search({ search, first: clampCount(filters.creators, SUGGEST_CREATORS_DEFAULT_LIMIT, 1, SUGGEST_SECTION_MAX_LIMIT) })
    ])

    const addresses = [
      ...new Set(
        [...catalog.data.map(item => item.creator), ...collections.rows.map(row => row.creator)].filter(Boolean).map(a => a.toLowerCase())
      )
    ]
    const names = new Map<string, string>()
    if (addresses.length > 0) {
      const result = await dappsDatabase.query<{ address: string; name: string | null }>(getCreatorDisplayNamesQuery(addresses))
      for (const row of result.rows) if (row.name) names.set(row.address, row.name)
    }
    const nameOf = (address: string | undefined | null) => (address ? names.get(address.toLowerCase()) ?? null : null)

    return {
      items: {
        data: catalog.data.map(item => ({ ...item, creatorName: nameOf(item.creator) })),
        total: catalog.total
      },
      collections: {
        data: collections.rows.map(row => ({
          contractAddress: row.collection_id,
          name: row.name,
          creator: row.creator,
          creatorName: nameOf(row.creator),
          items: Number(row.items),
          sales: Number(row.sales)
        }))
      },
      creators
    }
  }

  return { suggest }
}
