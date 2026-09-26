import { ethers } from 'ethers'
import SQL from 'sql-template-strings'
import { isErrorWithMessage } from '../../logic/errors'
import { AppComponents } from '../../types'
import { indexOf, readPhases, roundAtOrBefore, toDecimal } from './history'
import { DailyRate, IManaUsdHistoryComponent, OracleReader, OracleRound } from './types'

const AGGREGATOR_ABI = [
  'function decimals() view returns (uint8)',
  'function phaseId() view returns (uint16)',
  'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)',
  'function getRoundData(uint80) view returns (uint80, int256, uint256, uint256, uint80)'
]

// The first day the Polygon MANA/USD feed has a round for; nothing earlier can be priced from it.
export const FIRST_PRICED_DAY = '2021-07-08'
// Held for the length of one batch so the replicas do not all walk the same days.
const FILL_LOCK_KEY = 8_421_313
const DAY_MS = 86_400_000

/** The aggregator behind the configured proxy, as an {@link OracleReader}. */
export function createEthersOracleReader(rpcUrl: string, address: string): OracleReader {
  const provider = new ethers.JsonRpcProvider(rpcUrl, 137, { staticNetwork: true })
  const aggregator = new ethers.Contract(address, AGGREGATOR_ABI, provider)
  const toRound = (row: [bigint, bigint, bigint, bigint, bigint]): OracleRound => ({
    id: row[0],
    answer: row[1],
    updatedAt: Number(row[3])
  })
  return {
    decimals: async () => Number(await aggregator.decimals()),
    phaseId: async () => Number(await aggregator.phaseId()),
    latestRound: async () => toRound(await aggregator.latestRoundData()),
    round: async id => {
      try {
        const round = toRound(await aggregator.getRoundData(id))
        return round.updatedAt > 0 ? round : null
      } catch (e) {
        // Only a revert means the round does not exist. Anything else (a timeout, a rate limit, a bad
        // response) must abort the run: read as "no round", it would store a wrong close for good.
        if (ethers.isError(e, 'CALL_EXCEPTION')) return null
        throw e
      }
    }
  }
}

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Creates the MANA/USD history: the closing rate of each UTC day, read from the same on-chain feed the
 * catalogue prices with, so an old sale can be shown in what it was worth on the day it happened.
 *
 * @param components - The write database, logs, and a reader for the aggregator (null when unconfigured,
 *   which leaves the table as it is and every read answering from what is already stored).
 * @returns The history component.
 */
export function createManaUsdHistoryComponent(components: {
  dappsDatabase: Pick<AppComponents, 'dappsDatabase'>['dappsDatabase']
  logs: Pick<AppComponents, 'logs'>['logs']
  reader: OracleReader | null
}): IManaUsdHistoryComponent {
  const { dappsDatabase, logs, reader } = components
  const logger = logs.getLogger('mana-usd-history')

  async function fillMissingDays(maxDays: number): Promise<number | null> {
    if (!reader) return 0
    const client = await dappsDatabase.getPool().connect()
    try {
      const lock = await client.query<{ acquired: boolean }>(SQL`SELECT pg_try_advisory_lock(${FILL_LOCK_KEY}) AS acquired`)
      if (lock.rows[0]?.acquired !== true) return null
      try {
        const last = await client.query<{ day: string | null }>('SELECT MAX(day)::text AS day FROM marketplace.mana_usd_daily')
        const start = last.rows[0]?.day ? Date.parse(`${last.rows[0].day}T00:00:00Z`) + DAY_MS : Date.parse(`${FIRST_PRICED_DAY}T00:00:00Z`)
        // Yesterday is the last closed day; today's close is not known until it ends.
        const lastClosed = Date.parse(`${dayOf(Date.now())}T00:00:00Z`) - DAY_MS
        if (start > lastClosed) return 0

        // Every close of the batch is read before anything is written, so a failed read leaves no partial day.
        const [decimals, phases] = await Promise.all([reader.decimals(), readPhases(reader)])
        const closes: { day: string; usd: string; roundId: string }[] = []
        let resume: { phase: number; index: bigint } | undefined
        for (let day = start; day <= lastClosed && closes.length < maxDays; day += DAY_MS) {
          const close = await roundAtOrBefore(reader, phases, Math.floor((day + DAY_MS - 1) / 1000), resume)
          if (!close) continue
          resume = { phase: Number(close.id >> 64n), index: indexOf(close.id) }
          closes.push({ day: dayOf(day), usd: toDecimal(close.answer, decimals), roundId: close.id.toString() })
        }
        for (const close of closes) {
          await client.query(SQL`
            INSERT INTO marketplace.mana_usd_daily (day, usd, round_id)
            VALUES (${close.day}, ${close.usd}, ${close.roundId})
            ON CONFLICT (day) DO NOTHING`)
        }
        return closes.length
      } finally {
        await client.query(SQL`SELECT pg_advisory_unlock(${FILL_LOCK_KEY})`).catch((e: unknown) => {
          logger.warn(`Couldn't release the MANA/USD history lock: ${isErrorWithMessage(e) ? e.message : 'Unknown'}`)
        })
      }
    } catch (e) {
      logger.error(`Couldn't fill the MANA/USD history: ${isErrorWithMessage(e) ? e.message : 'Unknown'}`)
      throw e
    } finally {
      client.release()
    }
  }

  async function getDailyRates(from: number, to: number): Promise<DailyRate[]> {
    const result = await dappsDatabase.query<DailyRate>(SQL`
      SELECT day::text AS day, usd::text AS usd FROM marketplace.mana_usd_daily
      WHERE day BETWEEN ${dayOf(from)}::date AND ${dayOf(to)}::date
      ORDER BY day`)
    return result.rows
  }

  return { fillMissingDays, getDailyRates }
}
