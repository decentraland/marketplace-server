import { IBaseComponent } from '@well-known-components/interfaces'

// A small, fail-safe MANA/USD rate cache. It sources the SAME on-chain Chainlink-style MANA/USD
// aggregator that the credits-server oracle reads (latestRoundData -> USD per MANA, scaled by
// 10^decimals), so a price shown in the catalog stays coherent with what a purchase settles at.
// It caches the last-known rate and refreshes on an interval; reads never throw.
export interface IManaUsdRateComponent extends IBaseComponent {
  /**
   * Current MANA price in USD (USD per MANA, e.g. 0.025). Never throws: returns the last successfully
   * fetched rate, or the configured fallback if the oracle has not answered yet.
   */
  getRate(): number
  /**
   * Fetch the rate from the on-chain oracle and update the cache. Never throws: on failure it logs and
   * keeps the last-known value so the catalog is never crashed by a momentarily-unavailable rate.
   */
  refresh(): Promise<void>
}
