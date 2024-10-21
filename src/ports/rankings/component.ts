import { Network } from '@dcl/schemas'
import { AppComponents } from '../../types'
import { IItemsDayDataComponent, RankingEntity, RankingFragment, RankingsFilters, RankingsSortBy } from './types'
import { consolidateRankingResults, getRankingQuery, MAX_RESULTS, sortRankResults } from './utils'

export function createRankingsComponent(components: Pick<AppComponents, 'dappsDatabase'>): IItemsDayDataComponent {
  const { dappsDatabase } = components

  async function fetchRanking(entity: RankingEntity, filters: RankingsFilters) {
    const isFetchingAllTimeResults = filters.from === 0
    let page = 0
    let rankingFragments: RankingFragment[] = []
    while (true) {
      const query = getRankingQuery(entity, filters, page++)
      const { rankings: fragments } = await subgraph.query<{
        rankings: RankingFragment[]
      }>(query)
      rankingFragments = [...rankingFragments, ...fragments]
      if (fragments.length < MAX_RESULTS) {
        break
      }
    }
    const results = consolidateRankingResults(entity, rankingFragments, filters)
    const sortedResults = isFetchingAllTimeResults
      ? Object.values(results)
      : sortRankResults(entity, Object.values(results), filters.sortBy)

    return sortedResults.slice(0, filters.first)
  }

  async function fetch(entity: RankingEntity, filters: FetchOptions<RankingsFilters, RankingsSortBy>) {
    if (!isValid(network, filters)) {
      return []
    }

    return fetchRanking(entity, filters)
  }

  async function count(entity: RankingEntity, filters: RankingsFilters) {
    if (!isValid(network, filters)) {
      return 0
    }
    const ranking = await fetchRanking(entity, filters)
    return ranking.length
  }

  return {
    fetch,
    count
  }
}
