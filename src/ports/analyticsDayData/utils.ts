import SQL, { SQLStatement } from 'sql-template-strings'
import { AnalyticsDayData, AnalyticsDayDataFilters } from '@dcl/schemas'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { AnalyticsDayDataFragment, AnalyticsTimeframe } from './types'

export const getAnalyticsDayDataFragment = (): SQLStatement =>
  SQL`
  SELECT 
    id,
    date,
    sales,
    volume,
    creators_earnings,
    dao_earnings
  FROM `.append(MARKETPLACE_SQUID_SCHEMA).append(SQL`.analytics_day_data
`)

export const getAnalyticsTotalDataFragment = (): SQLStatement =>
  SQL`
  SELECT 
    id,
    SUM(sales) AS sales,
    SUM(volume) AS volume,
    SUM(creators_earnings),
    SUM(dao_earnings)
  FROM `.append(MARKETPLACE_SQUID_SCHEMA).append(SQL`.analytics_day_data
  GROUP BY id
`)

export function getAnalyticsDayDataQuery(filters: AnalyticsDayDataFilters): SQLStatement {
  const query = SQL`
    SELECT 
      id,
      date,
      sales,
      volume,
      creators_earnings,
      dao_earnings
    FROM `.append(MARKETPLACE_SQUID_SCHEMA).append(SQL`.analytics_day_data
  `)

  if (filters.from) {
    query.append(SQL` WHERE date > ${Math.round(filters.from / 1000)}`)
  }
  return query
}

export function getAnalyticsTotalDataQuery(): SQLStatement {
  return SQL`
    SELECT 
      id,
      SUM(sales) AS sales,
      SUM(volume) AS volume,
      SUM(creators_earnings),
      SUM(dao_earnings)
    FROM `.append(MARKETPLACE_SQUID_SCHEMA).append(SQL`.analytics_day_data
    GROUP BY id
  `)
}

export function mapAnalyticsFragment(fragment: AnalyticsDayDataFragment): AnalyticsDayData {
  return { ...fragment, creatorsEarnings: fragment.creators_earnings, daoEarnings: fragment.dao_earnings }
}

export function getDateXDaysAgo(numOfDays: number, date = new Date()): Date {
  const daysAgo = new Date(date.getTime())
  daysAgo.setDate(date.getDate() - numOfDays)
  daysAgo.setHours(0, 0, 0, 0)
  return daysAgo
}

export function getTimestampFromTimeframe(timeframe: AnalyticsTimeframe): number {
  switch (timeframe) {
    case AnalyticsTimeframe.DAY:
      return getDateXDaysAgo(1).getTime()
    case AnalyticsTimeframe.WEEK:
      return getDateXDaysAgo(7).getTime()
    case AnalyticsTimeframe.MONTH:
      return getDateXDaysAgo(30).getTime()
    case AnalyticsTimeframe.ALL:
      return 0
    default:
      return 0
  }
}
