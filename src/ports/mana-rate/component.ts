import { ethers } from 'ethers'
import { isErrorWithMessage } from '../../logic/errors'
import { AppComponents } from '../../types'
import { IManaUsdRateComponent } from './types'

// Minimal Chainlink aggregator ABI -- the exact interface the credits-server oracle reads. Sourcing
// the SAME feed keeps the credit price we advertise coherent with the amount a purchase settles at.
const AGGREGATOR_ABI = [
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)'
]

// Refresh cadence (~90s) and a dev/testnet fallback rate, both config-overridable. The fallback is
// only used before the first successful fetch; after that the last-known value is kept on failure.
const DEFAULT_REFRESH_INTERVAL_MS = 90_000
const DEFAULT_FALLBACK_RATE = 0.02 // USD per MANA
const DEFAULT_MAX_STALENESS_SECONDS = 86_400

export async function createManaUsdRateComponent(components: Pick<AppComponents, 'config' | 'logs'>): Promise<IManaUsdRateComponent> {
  const { config, logs } = components
  const logger = logs.getLogger('mana-usd-rate')

  const refreshIntervalMs = (await config.getNumber('MANA_RATE_REFRESH_INTERVAL_MS')) ?? DEFAULT_REFRESH_INTERVAL_MS
  const fallbackRate = (await config.getNumber('MANA_USD_FALLBACK_RATE')) ?? DEFAULT_FALLBACK_RATE
  const maxStalenessSeconds = (await config.getNumber('MANA_ORACLE_MAX_STALENESS_SECONDS')) ?? DEFAULT_MAX_STALENESS_SECONDS

  // Last successfully-fetched rate; `undefined` until the first success, in which case getRate() falls
  // back to the configured value.
  let cachedRate: number | undefined
  let interval: ReturnType<typeof setInterval> | undefined

  let aggregator: ethers.Contract | undefined
  let decimalsCache: number | undefined

  // Built on first use so a missing RPC/oracle address only degrades to the fallback rate, never crashes.
  async function getAggregator(): Promise<ethers.Contract | undefined> {
    if (!aggregator) {
      const rpcUrl = await config.getString('RPC_ENDPOINT_POLYGON')
      const oracleAddress = await config.getString('MANA_USD_ORACLE_ADDRESS')
      if (!rpcUrl || !oracleAddress) {
        return undefined
      }
      aggregator = new ethers.Contract(oracleAddress, AGGREGATOR_ABI, new ethers.JsonRpcProvider(rpcUrl))
    }
    return aggregator
  }

  // Reads the aggregator and returns USD per MANA as a decimal. Applies the same completeness and
  // staleness guards as the credits-server oracle so we never advertise a price off a bad round.
  async function fetchRate(): Promise<number> {
    const agg = await getAggregator()
    if (!agg) {
      throw new Error('MANA/USD oracle not configured (RPC_ENDPOINT_POLYGON, MANA_USD_ORACLE_ADDRESS)')
    }
    if (decimalsCache === undefined) {
      decimalsCache = Number(await agg.decimals())
    }
    const roundData = await agg.latestRoundData()
    const answer = BigInt(roundData[1]) // USD per MANA, scaled by 10^decimals
    if (answer <= 0n) {
      throw new Error('Oracle returned a non-positive MANA/USD rate')
    }
    const roundId = BigInt(roundData[0])
    const answeredInRound = BigInt(roundData[4])
    if (answeredInRound < roundId) {
      throw new Error('Oracle round is incomplete (answeredInRound < roundId)')
    }
    const updatedAt = Number(roundData[3])
    const ageSeconds = Math.floor(Date.now() / 1000) - updatedAt
    if (!Number.isFinite(updatedAt) || updatedAt <= 0 || ageSeconds > maxStalenessSeconds) {
      throw new Error(`Oracle rate is stale (age ${ageSeconds}s > ${maxStalenessSeconds}s)`)
    }
    return Number(answer) / 10 ** decimalsCache
  }

  async function refresh(): Promise<void> {
    try {
      const rate = await fetchRate()
      cachedRate = rate
      logger.debug('MANA/USD rate refreshed', { rate })
    } catch (error) {
      logger.warn(
        `Failed to refresh MANA/USD rate, keeping last-known/fallback (${getRate()}): ${
          isErrorWithMessage(error) ? error.message : 'unknown error'
        }`
      )
    }
  }

  function getRate(): number {
    return cachedRate ?? fallbackRate
  }

  async function start(): Promise<void> {
    await refresh()
    interval = setInterval(() => {
      refresh().catch(() => undefined)
    }, refreshIntervalMs)
    // Don't keep the process alive just for the refresh timer.
    interval.unref?.()
  }

  async function stop(): Promise<void> {
    if (interval) {
      clearInterval(interval)
      interval = undefined
    }
  }

  return { getRate, refresh, start, stop }
}
