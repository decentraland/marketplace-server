import { AppComponents } from '../../types'
import { getEstatesSizesQuery } from './queries'
import {
  FetchEstateSizesQueryFragment,
  IStatsComponent,
  StatsCategory,
  StatsResourceParams,
  EstateStat,
  StatsResourceFilters
} from './types'
import { consolidateSizes } from './utils'

export function createStatsComponent(components: Pick<AppComponents, 'dappsDatabase'>): IStatsComponent {
  const { dappsDatabase } = components

  function isValid(filters: StatsResourceParams) {
    const { category } = filters
    return Object.values(StatsCategory).includes(category)
  }

  async function fetchEstateSizes(filters: StatsResourceFilters) {
    const query = getEstatesSizesQuery(filters)
    const results = await dappsDatabase.query<FetchEstateSizesQueryFragment>(query)
    return consolidateSizes(results.rows)
  }

  async function fetch(params: StatsResourceParams, filters: StatsResourceFilters) {
    if (!isValid(params)) {
      return []
    }
    const { category, stat } = params
    switch (category) {
      case StatsCategory.ESTATE:
        if (stat === EstateStat.SIZE) {
          return fetchEstateSizes(filters)
        }
        break
      default:
        break
    }

    return {}
  }

  return {
    fetch
  }
}
