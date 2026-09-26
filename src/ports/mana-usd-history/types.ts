import { IBaseComponent } from '@well-known-components/interfaces'

/** One round of the MANA/USD aggregator: its proxy round id, the answer, and when it was written (seconds). */
export type OracleRound = { id: bigint; answer: bigint; updatedAt: number }

/** Read access to a Chainlink-style aggregator proxy, reduced to what walking its history needs. */
export type OracleReader = {
  decimals(): Promise<number>
  phaseId(): Promise<number>
  latestRound(): Promise<OracleRound>
  /** A round by proxy id, or null when the id is past the end of its phase (the proxy reverts or answers zero). */
  round(id: bigint): Promise<OracleRound | null>
}

/** The closing MANA/USD rate of one UTC day. */
export type DailyRate = {
  /** YYYY-MM-DD, UTC. */
  day: string
  /** USD per MANA, as a decimal string at the oracle's own precision. */
  usd: string
}

export interface IManaUsdHistoryComponent extends IBaseComponent {
  /**
   * Stores the closing rate of every day missing from the table, oldest first, up to `maxDays` per call.
   *
   * @param maxDays - How many days one call may fill, so a backfill spreads over several runs.
   * @returns How many days were stored, or null when another replica holds the lock.
   */
  fillMissingDays(maxDays: number): Promise<number | null>
  /**
   * The stored closing rates between two instants, inclusive.
   *
   * @param from - Epoch milliseconds.
   * @param to - Epoch milliseconds.
   * @returns One rate per stored day in the range, oldest first.
   */
  getDailyRates(from: number, to: number): Promise<DailyRate[]>
}
