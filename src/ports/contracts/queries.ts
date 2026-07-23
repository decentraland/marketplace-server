import SQL, { SQLStatement } from 'sql-template-strings'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getDBNetworks } from '../../utils'
import { getLimitAndOffsetStatement } from '../pagination'
import { getWhereStatementFromFilters } from '../utils'
import { ContractFilters } from './types'

function getContractsWhereStatement(filters: ContractFilters): SQLStatement {
  const FILTER_BY_APPROVED = SQL`c.is_approved = true`
  const FILTER_BY_NETWORK = filters.network ? SQL`c.network = ANY(${getDBNetworks(filters.network)})` : null

  return getWhereStatementFromFilters([FILTER_BY_APPROVED, FILTER_BY_NETWORK])
}

/**
 * Query to get collections
 */
export function getCollectionsQuery(filters: ContractFilters): SQLStatement {
  return SQL`
    SELECT
      c.id,
      c.name,
      c.chain_id,
      c.network
    FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.collection c`)
    .append(getContractsWhereStatement(filters))
    .append(
      SQL`
    ORDER BY c.name ASC`
    )
    .append(getLimitAndOffsetStatement(filters, { maxLimit: 1000 }))
}

export function getCollectionsCountQuery(filters: ContractFilters): SQLStatement {
  return SQL`
    SELECT COUNT(c.id) as count
    FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.collection c`)
    .append(getContractsWhereStatement(filters))
}
