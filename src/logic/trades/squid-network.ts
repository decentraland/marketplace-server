import { SquidNetwork } from '../../types'

// The trades indexer spells Polygon POLYGON while marketplace.trades.network holds @dcl/schemas' MATIC.

/** A trade network in the indexer's spelling. */
export function toSquidNetwork(network: string): string {
  return network === 'MATIC' ? SquidNetwork.POLYGON : network
}

/** An indexer network in the trades' spelling. */
export function fromSquidNetwork(network: string): string {
  return network === SquidNetwork.POLYGON ? 'MATIC' : network
}

/** SQL for toSquidNetwork over a column. The column is a fixed SQL identifier, never user input. */
export function toSquidNetworkSql(column: string): string {
  return `CASE WHEN ${column} = 'MATIC' THEN '${SquidNetwork.POLYGON}' ELSE ${column} END`
}
