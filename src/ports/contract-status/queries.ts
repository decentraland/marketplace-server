import SQL, { SQLStatement } from 'sql-template-strings'

// The indexer keys rows by `${address}-${network}`, so each paused deployment comes back once.
export function getPausedContractsQuery(): SQLStatement {
  return SQL`SELECT address, network FROM squid_trades.contract_status WHERE paused`
}
