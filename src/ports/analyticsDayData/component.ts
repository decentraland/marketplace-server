import { AnalyticsDayDataFilters } from '@dcl/schemas'
import { AppComponents } from '../../types'
import { AnalyticsDayDataFragment, IAnalyticsDayDataComponent } from './types'
import { getAnalyticsDayDataQuery, getAnalyticsTotalDataQuery, mapAnalyticsFragment } from './utils'

export function createAnalyticsDayDataComponent(components: Pick<AppComponents, 'dappsDatabase'>): IAnalyticsDayDataComponent {
  const { dappsDatabase } = components

  async function fetch(filters: AnalyticsDayDataFilters & { first: number }) {
    const query = filters.from === 0 ? getAnalyticsTotalDataQuery() : getAnalyticsDayDataQuery(filters)

    const analytics = await dappsDatabase.query<AnalyticsDayDataFragment>(query)
    console.log('analytics: ', analytics)
    console.log('query: ', query)

    return analytics.rows.map(mapAnalyticsFragment)
  }

  return {
    fetch
  }
}
