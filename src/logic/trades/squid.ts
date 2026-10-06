/**
 * The trades indexer's network of the trade aliased `tradeAlias`, as SQL. The indexer spells Polygon
 * POLYGON while marketplace.trades.network holds @dcl/schemas' MATIC, so a raw equality never matches a
 * Polygon trade.
 */
export function squidTradesNetwork(tradeAlias: string): string {
  return `CASE WHEN ${tradeAlias}.network = 'MATIC' THEN 'POLYGON' ELSE ${tradeAlias}.network END`
}
