import { getAccumulatedAnalyticsData } from '../../logic/volume'
import { AppComponents } from '../../types'
import { AnalyticsTimeframe } from '../analyticsDayData/types'
import { getTimestampFromTimeframe } from '../analyticsDayData/utils'
import { IVolumeComponent } from './types'

export function createVolumeComponent(components: Pick<AppComponents, 'analyticsData'>): IVolumeComponent {
  const { analyticsData } = components
  async function fetch(timeframe: AnalyticsTimeframe) {
    return getAccumulatedAnalyticsData(
      await analyticsData.fetch({
        from: getTimestampFromTimeframe(timeframe),
        first: 0
      })
    )
  }

  return {
    fetch
  }
}
