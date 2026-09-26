import { ILoggerComponent } from '@well-known-components/interfaces'
import { IPgComponent } from '../../src/ports/db/types'
import { createManaUsdHistoryComponent } from '../../src/ports/mana-usd-history/component'
import { roundId } from '../../src/ports/mana-usd-history/history'
import { OracleReader } from '../../src/ports/mana-usd-history/types'
import { createTestLogsComponent, createTestPgComponent } from '../components'

const DAY = 86_400
let logs: ILoggerComponent
let dappsDatabase: IPgComponent
let queryMock: jest.Mock
let releaseMock: jest.Mock
let lastStoredDay: string | null
let lockAcquired: boolean

// One round at noon UTC every day, starting 2021-07-08.
const START = Date.parse('2021-07-08T12:00:00Z') / 1000
const reader: OracleReader = {
  decimals: () => Promise.resolve(8),
  phaseId: () => Promise.resolve(1),
  latestRound: () => Promise.resolve({ id: roundId(1, 5000n), answer: 1n, updatedAt: START + 4999 * DAY }),
  round: id => {
    const index = Number(id & ((1n << 64n) - 1n))
    return Promise.resolve(
      index >= 1 && index <= 5000 ? { id, answer: BigInt(index) * 1_000_000n, updatedAt: START + (index - 1) * DAY } : null
    )
  }
}

beforeEach(() => {
  lastStoredDay = null
  lockAcquired = true
  logs = createTestLogsComponent({
    getLogger: jest.fn().mockReturnValue({ error: () => undefined, info: () => undefined, warn: () => undefined })
  })
  releaseMock = jest.fn()
  queryMock = jest.fn((query: unknown) => {
    const text = typeof query === 'string' ? query : (query as { text: string }).text
    if (text.includes('pg_try_advisory_lock')) return Promise.resolve({ rows: [{ acquired: lockAcquired }] })
    if (text.includes('MAX(day)')) return Promise.resolve({ rows: [{ day: lastStoredDay }] })
    return Promise.resolve({ rows: [] })
  })
  dappsDatabase = createTestPgComponent({
    getPool: jest.fn().mockReturnValue({ connect: () => ({ query: queryMock, release: releaseMock }) })
  })
})

function inserts(): { day: string; usd: string }[] {
  return queryMock.mock.calls
    .map(([query]) => query as { text?: string; values?: unknown[] })
    .filter(query => query.text?.includes('INSERT INTO marketplace.mana_usd_daily'))
    .map(query => ({ day: query.values?.[0] as string, usd: query.values?.[1] as string }))
}

describe('when filling the missing days of the MANA/USD history', () => {
  describe('and the table is empty', () => {
    it('should start on the first day the feed has, up to the batch size', async () => {
      const history = createManaUsdHistoryComponent({ dappsDatabase, logs, reader })

      expect(await history.fillMissingDays(3)).toBe(3)
      expect(inserts()).toEqual([
        { day: '2021-07-08', usd: '0.01' },
        { day: '2021-07-09', usd: '0.02' },
        { day: '2021-07-10', usd: '0.03' }
      ])
      expect(releaseMock).toHaveBeenCalled()
    })
  })

  describe('and some days are already stored', () => {
    beforeEach(() => {
      lastStoredDay = '2021-07-20'
    })

    it('should continue from the day after the last one', async () => {
      const history = createManaUsdHistoryComponent({ dappsDatabase, logs, reader })

      await history.fillMissingDays(1)

      expect(inserts()).toEqual([{ day: '2021-07-21', usd: '0.14' }])
    })
  })

  describe('and another replica holds the lock', () => {
    beforeEach(() => {
      lockAcquired = false
    })

    it('should store nothing and say so', async () => {
      const history = createManaUsdHistoryComponent({ dappsDatabase, logs, reader })

      expect(await history.fillMissingDays(3)).toBeNull()
      expect(inserts()).toEqual([])
    })
  })

  describe('and no oracle is configured', () => {
    it('should store nothing without touching the database', async () => {
      const history = createManaUsdHistoryComponent({ dappsDatabase, logs, reader: null })

      expect(await history.fillMissingDays(3)).toBe(0)
      expect(queryMock).not.toHaveBeenCalled()
    })
  })

  describe('and the oracle fails partway through the batch', () => {
    it('should store none of the batch and throw', async () => {
      let reads = 0
      const flaky: OracleReader = {
        ...reader,
        round: id => {
          reads++
          return reads > 60 ? Promise.reject(new Error('rate limited')) : reader.round(id)
        }
      }
      const history = createManaUsdHistoryComponent({ dappsDatabase, logs, reader: flaky })

      await expect(history.fillMissingDays(30)).rejects.toThrow('rate limited')
      expect(inserts()).toEqual([])
      expect(releaseMock).toHaveBeenCalled()
    })
  })
})
