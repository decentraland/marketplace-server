/**
 * Joins the trades indexer's `contract_status` row for the marketplace contract a trade targets.
 *
 * Read at query time rather than baked into `mv_trades`, so a pause shows up without a view refresh. The row
 * is keyed by contract and network, so at most one matches per trade and the join never multiplies rows.
 * Same MATIC -> POLYGON translation as the signature_index joins: the indexer spells Polygon POLYGON while
 * trades.network holds @dcl/schemas' MATIC.
 *
 * Every argument is a fixed SQL identifier, never user input.
 */
export function getContractStatusJoin(alias: string, contractColumn: string, networkColumn: string): string {
  return `
    LEFT JOIN squid_trades.contract_status AS ${alias}
      ON ${alias}.address = LOWER(${contractColumn})
      AND ${alias}.network = CASE WHEN ${networkColumn} = 'MATIC' THEN 'POLYGON' ELSE ${networkColumn} END `
}

// A contract with no status row has never been paused.
export function getPausedColumn(alias: string): string {
  return `COALESCE(${alias}.paused, false)`
}
