import SQL, { SQLStatement } from 'sql-template-strings'
import { PausedContract } from '../../ports/contract-status/types'

// Matches a trade to the paused set by `${lowercased contract}-${network}`, network in the trades' spelling.
export function getPausedContractKey(address: string, network: string): string {
  return `${address.toLowerCase()}-${network}`
}

/**
 * Whether a trade's marketplace contract is in the paused set. A constant `false` when nothing is paused,
 * so the common case costs nothing. Columns are fixed SQL identifiers, never user input.
 */
export function getPausedExpression(pausedContracts: PausedContract[], contractColumn: string, networkColumn: string): SQLStatement {
  if (!pausedContracts.length) {
    return SQL`false`
  }
  const keys = pausedContracts.map(({ address, network }) => getPausedContractKey(address, network))
  return SQL`(LOWER(`
    .append(contractColumn)
    .append(") || '-' || ")
    .append(networkColumn)
    .append(SQL`) = ANY(${keys}::text[])`)
}
