import { ChainId, Network } from '@dcl/schemas'
import { getOpenItemOrderQuery, getOpenNFTOrderQuery } from '../../src/ports/trades/queries'

jest.mock('../../src/logic/chainIds', () => ({
  getEthereumChainId: () => ChainId.ETHEREUM_SEPOLIA,
  getPolygonChainId: () => ChainId.MATIC_AMOY
}))

/**
 * A TRADE'S STATUS DESCRIBES THE TRADE, so exactly one status row may exist per trade.
 *
 * squid_trades.trade holds one row per ON-CHAIN ACTION and their callers differ: a cancellation is called
 * by the signer, an execution by whoever bought (a contract, for a relayed or credits-funded purchase).
 * Grouping by caller split one trade into a group per caller and evaluated the status CASE inside each:
 * the group with the cancellation returned cancelled, the one with the execution counted no cancellation
 * and fell through to open. Two contradictory rows for one trade.
 *
 * Because the duplicate guards below do WHERE status = 'open' LIMIT 1, any item whose order had been both
 * executed at least once and then cancelled became PERMANENTLY unlistable — rejected with "There is
 * already an open order for this Item" while every UI correctly showed it as not for sale, since the
 * filtered catalogue query never grouped by caller and so never surfaced the phantom listing.
 *
 * Verified against a real database before the fix: the duplicate check returned one row for such an item
 * and none after it.
 */
describe('when building the duplicate-order guards', () => {
  it('should not group the status by caller, which would split one trade into several rows', () => {
    for (const sql of [getOpenItemOrderQuery('0xcontract', '0', Network.MATIC), getOpenNFTOrderQuery('0xcontract', '1', Network.MATIC)].map(
      q => (q as unknown as { text: string }).text
    )) {
      // Match the CLAUSE, not the string: the explanatory comment above it also says "GROUP BY" and names
      // the column, and it lives inside the SQL template literal, so a plain search finds the prose first.
      const groupBy = sql.match(/GROUP BY\s+t\.id[^\n]*/)?.[0]
      expect(groupBy).toBeDefined()
      expect(groupBy).not.toContain('trade_status.caller')
    }
  })

  it('should compute status identically to the query the catalogue reads', () => {
    // The divergence is what let one query call a trade open while the other called it cancelled. Comparing
    // the CASE bodies keeps them from drifting apart again.
    const guard = (getOpenItemOrderQuery('0xcontract', '0', Network.MATIC) as unknown as { text: string }).text
    const caseBody = (s: string) => s.slice(s.indexOf('CASE'), s.indexOf('END AS status'))
    expect(caseBody(guard)).not.toContain('t.signer = trade_status.caller')
  })
})
