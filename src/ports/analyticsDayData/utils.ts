import SQL, { SQLStatement } from 'sql-template-strings'
import { AnalyticsDayData, AnalyticsDayDataFilters } from '@dcl/schemas'
import { AnalyticsDayDataFragment, AnalyticsTimeframe, RentalsAnalyticsDayDataFragment } from './types'

export const getAnalyticsDayDataFragment = (): SQLStatement => SQL`
  SELECT 
    id,
    date,
    sales,
    volume,
    creators_earnings AS creatorsEarnings,
    dao_earnings AS daoEarnings
  FROM squid_marketplace.analytics_day_data
`

export const getAnalyticsTotalDataFragment = (): SQLStatement => SQL`
  SELECT 
    id,
    SUM(sales) AS sales,
    SUM(volume) AS volume,
    SUM(creators_earnings) AS creatorsEarnings,
    SUM(dao_earnings) AS daoEarnings
  FROM squid_marketplace.analytics_day_data
  GROUP BY id
`

export function getAnalyticsDayDataQuery(filters: AnalyticsDayDataFilters): SQLStatement {
  const query = SQL`
    SELECT 
      id,
      date,
      sales,
      volume,
      creators_earnings AS creatorsEarnings,
      dao_earnings AS daoEarnings
    FROM squid_marketplace.analytics_day_data
  `
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
      SUM(creators_earnings) AS creatorsEarnings,
      SUM(dao_earnings) AS daoEarnings
    FROM squid_marketplace.analytics_day_data
    GROUP BY id
  `
}

export function mapAnalyticsFragment(fragment: AnalyticsDayDataFragment): AnalyticsDayData {
  // No mapping is needed; return the fragment directly as AnalyticsDayData
  return fragment
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

// Rentals Analytics

export function getRentalsAnalyticsDayDataQuery({ from }: AnalyticsDayDataFilters): SQLStatement {
  const query = SQL`
    SELECT 
      id,
      date,
      volume,
      lessor_earnings AS lessorEarnings,
      fee_collector_earnings AS feeCollectorEarnings
    FROM squid_marketplace.rentals_analytics_day_data
  `
  if (from) {
    query.append(SQL` WHERE date > ${Math.round(from / 1000)}`)
  }
  return query
}

export function getRentalsAnalyticsTotalDataQuery(): SQLStatement {
  return SQL`
    SELECT 
      id,
      SUM(volume) AS volume,
      SUM(lessor_earnings) AS lessorEarnings,
      SUM(fee_collector_earnings) AS feeCollectorEarnings
    FROM RentalsAnalyticsDayData
    GROUP BY id
  `
}

export function mapRentalsAnalyticsFragment(fragment: RentalsAnalyticsDayDataFragment): AnalyticsDayData {
  return {
    id: fragment.id === 'analytics-total-data' ? 'all' : fragment.id,
    date: fragment.date,
    sales: 0,
    volume: fragment.volume,
    creatorsEarnings: fragment.lessorEarnings,
    daoEarnings: fragment.feeCollectorEarnings
  }
}
