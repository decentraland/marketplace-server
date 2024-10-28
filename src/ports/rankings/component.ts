import { AppComponents } from '../../types'
import { consolidateRankingResults, getRankingQuery, sortRankResults } from './queries'
import { IItemsDayDataComponent, RankingEntity, RankingFragment, RankingsFilters } from './types'

export function createRankingsComponent(components: Pick<AppComponents, 'dappsDatabase'>): IItemsDayDataComponent {
  const { dappsDatabase } = components

  async function fetchRanking(entity: RankingEntity, filters: RankingsFilters) {
    const isFetchingAllTimeResults = filters.from === 0
    const query = getRankingQuery(entity, filters)
    const dbResponse = await dappsDatabase.query<RankingFragment>(query)

    const results = consolidateRankingResults(entity, dbResponse.rows, filters)
    const sortedResults = isFetchingAllTimeResults
      ? Object.values(results)
      : sortRankResults(entity, Object.values(results), filters.sortBy)

    return sortedResults.slice(0, filters.first)
  }

  async function fetch(entity: RankingEntity, filters: RankingsFilters) {
    return fetchRanking(entity, filters)
  }

  return {
    fetch
  }
}
