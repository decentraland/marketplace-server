import SQL, { SQLStatement } from 'sql-template-strings'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { getDBNetworks } from '../../utils'
import { getWhereStatementFromFilters } from '../utils'
import { ContractFilters } from './types'

function getContractsWhereStatement(filters: ContractFilters): SQLStatement {
  const FILTER_BY_NETWORK = filters.network ? SQL`c.network = ANY(${getDBNetworks(filters.network)})` : null

  return getWhereStatementFromFilters([FILTER_BY_NETWORK])
}

function getContractsLimitAndOffsetStatement(filters: ContractFilters): SQLStatement {
  const limit = filters?.first ? filters.first : 1000
  const offset = filters?.skip ? filters.skip : 0

  return SQL` LIMIT ${limit} OFFSET ${offset} `
}

/**
 * Query to get collections with their item types
 * This query aggregates item types per collection to determine if they have wearables or emotes
 */
export function getCollectionsWithItemTypesQuery(filters: ContractFilters): SQLStatement {
  return SQL`
    SELECT 
      c.id,
      c.name,
      c.chain_id,
      c.network,
      array_agg(DISTINCT i.item_type) as item_types,
      COUNT(*) OVER() as count
    FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.collection c`)
    .append(SQL`
    INNER JOIN `)
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.item i ON i.collection_id = c.id`)
    .append(getContractsWhereStatement(filters))
    .append(SQL` AND c.is_approved = true
    GROUP BY c.id, c.name, c.chain_id, c.network
    ORDER BY c.name ASC`)
    .append(getContractsLimitAndOffsetStatement(filters))
}

export function getCollectionsCountQuery(filters: ContractFilters): SQLStatement {
  return SQL`
    SELECT COUNT(DISTINCT c.id) as count
    FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.collection c`)
    .append(SQL`
    INNER JOIN `)
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.item i ON i.collection_id = c.id`)
    .append(getContractsWhereStatement(filters))
    .append(SQL` AND c.is_approved = true`)
}

