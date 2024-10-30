import { AnalyticsDayData, AnalyticsDayDataFilters } from '@dcl/schemas'

export enum AnalyticsTimeframe {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  ALL = 'all'
}

export interface IAnalyticsDayDataComponent {
  fetch(filters: AnalyticsDayDataFilters & { first: number }): Promise<AnalyticsDayData[]>
}

export type AnalyticsDayDataFragment = {
  id: string
  date: number
  sales: number
  volume: string
  creators_earnings: string
  dao_earnings: string
}
