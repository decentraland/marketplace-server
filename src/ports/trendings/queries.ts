import SQL from 'sql-template-strings'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { TrendingFilters } from './types'

export function getTrendingSalesQuery(filters: TrendingFilters) {
  const { from, skip, first } = filters

  const query = SQL`
    SELECT 
      search_item_id, 
      search_contract_address, 
      COUNT(*) OVER() AS total_count 
    FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.sale 
  `
    )

  if (from) {
    const fromTimestamp = Math.round(from / 1000)
    query.append(SQL`WHERE timestamp > ${fromTimestamp}`)
  }

  query.append(SQL`ORDER BY timestamp DESC `)

  if (first) {
    query.append(SQL`LIMIT ${first} `)
  }

  if (skip) {
    query.append(SQL`OFFSET ${skip} `)
  }

  return query
}
