import SQL, { SQLStatement } from 'sql-template-strings'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getDBNetworks } from '../../utils'
import { getWhereStatementFromFilters } from '../utils'
import { AccountFilters, AccountSortBy } from './types'

function getAccountsSortByStatement(filters: AccountFilters): SQLStatement {
  switch (filters.sortBy) {
    case AccountSortBy.MOST_SALES:
      return SQL` ORDER BY sales DESC `
    case AccountSortBy.MOST_PURCHASES:
      return SQL` ORDER BY purchases DESC `
    case AccountSortBy.MOST_ROYALTIES:
      return SQL` ORDER BY royalties DESC `
    case AccountSortBy.MOST_COLLECTIONS:
      return SQL` ORDER BY collections DESC `
    case AccountSortBy.MOST_EARNED:
      return SQL` ORDER BY earned DESC `
    case AccountSortBy.MOST_SPENT:
      return SQL` ORDER BY spent DESC `
    default:
      return SQL` ORDER BY sales DESC `
  }
}

function getAccountsLimitAndOffsetStatement(filters: AccountFilters): SQLStatement {
  const MAX_LIMIT = 1000
  const limit = filters?.first ? Math.min(filters.first, MAX_LIMIT) : MAX_LIMIT
  const offset = filters?.skip ? filters.skip : 0

  return SQL` LIMIT ${limit} OFFSET ${offset} `
}

function getAccountsWhereStatement(filters: AccountFilters): SQLStatement {
  // Fetch by id using -ETHEREUM and -POLYGON suffixes
  const FILTER_BY_ID = filters.id ? SQL`id = ANY(${[filters.id, `${filters.id}-ETHEREUM`, `${filters.id}-POLYGON`]})` : null
  const FILTER_BY_ADDRESS =
    filters.address && filters.address.length > 0 ? SQL`address = ANY(${filters.address.map(addr => addr.toLowerCase())})` : null
  const FILTER_BY_NETWORK = filters.network ? SQL`network = ANY(${getDBNetworks(filters.network)})` : null

  return getWhereStatementFromFilters([FILTER_BY_ID, FILTER_BY_ADDRESS, FILTER_BY_NETWORK])
}

export function getAccountsQuery(filters: AccountFilters): SQLStatement {
  return SQL`
    SELECT 
      id,
      address,
      sales,
      purchases,
      spent,
      earned,
      royalties,
      collections,
      COUNT(*) OVER() as count
    FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.account`)
    .append(getAccountsWhereStatement(filters))
    .append(getAccountsSortByStatement(filters))
    .append(getAccountsLimitAndOffsetStatement(filters))
}

export function getAccountsCountQuery(filters: AccountFilters): SQLStatement {
  return SQL`
    SELECT COUNT(*) as count
    FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.account`)
    .append(getAccountsWhereStatement(filters))
}
