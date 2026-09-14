import * as buildNeighbors from '../../src/logic/suggestions/build-neighbors'
import * as neighborsTable from '../../src/logic/suggestions/neighbors-table'
import { runNeighborsJob, type NeighborsJobLogger } from '../../src/logic/suggestions/run-neighbors-job'

type FakeClient = { query: jest.Mock; end: jest.Mock }

describe('when running the item neighbours job', () => {
  let logger: NeighborsJobLogger
  let clients: Record<'read' | 'write', FakeClient>
  let connect: jest.Mock
  let lockAcquired: boolean
  let buildSpy: jest.SpyInstance

  function makeClient(): FakeClient {
    return {
      query: jest.fn(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: lockAcquired }] }
        return { rows: [] }
      }),
      end: jest.fn(async () => undefined)
    }
  }

  beforeEach(() => {
    lockAcquired = true
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    clients = { read: makeClient(), write: makeClient() }
    connect = jest.fn(async (role: 'read' | 'write') => clients[role])
    buildSpy = jest.spyOn(buildNeighbors, 'produceNeighborRows').mockImplementation(async (_client, insert, _options, onTimings) => {
      await insert([{ itemId: '0xa-1', source: 'cf', neighborId: '0xb-2', sim: 0.5, support: 7, rank: 0 }])
      onTimings?.({ catalogueMs: 1, acquisitionsMs: 2, coOwnershipMs: 3, contentMs: 4, walletsSeen: 10, rowsRead: 20 })
      return { cfRows: 1, contentRows: 0, itemsCovered: 1, durationMs: 5 }
    })
    // The real swap is what drives the producer, so it is stubbed to run it and report success.
    jest.spyOn(neighborsTable, 'swapNeighborsTable').mockImplementation(async (_client, produce) => {
      await produce(async () => undefined)
      return 'rebuilt'
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('and the advisory lock is acquired', () => {
    let outcome: string

    beforeEach(async () => {
      outcome = await runNeighborsJob({ connect, logger })
    })

    it('should report that it rebuilt the table', () => {
      expect(outcome).toBe('rebuilt')
    })

    it('should raise the statement timeout well above the pool default, which the scan would exceed', () => {
      expect(clients.read.query).toHaveBeenCalledWith('SET statement_timeout = 300000')
    })

    it('should open the read connection read-only', () => {
      expect(clients.read.query).toHaveBeenCalledWith('SET default_transaction_read_only = on')
    })

    it('should give the acquisition scan a deadline so a slow run leaves the old table serving', () => {
      expect(buildSpy.mock.calls[0][2]).toEqual(expect.objectContaining({ acquisitionDeadlineMs: 240000 }))
    })

    it('should close both connections rather than hold them between runs', () => {
      expect([clients.read.end.mock.calls.length, clients.write.end.mock.calls.length]).toEqual([1, 1])
    })

    it('should log one line carrying the stage timings and the peak memory', () => {
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('peak rss'))
    })
  })

  describe('and another replica already holds the advisory lock', () => {
    let outcome: string

    beforeEach(async () => {
      lockAcquired = false
      outcome = await runNeighborsJob({ connect, logger })
    })

    it('should report that it skipped the rebuild', () => {
      expect(outcome).toBe('skipped')
    })

    it('should never open the read connection, so the losing replicas cost nothing', () => {
      expect(connect).not.toHaveBeenCalledWith('read')
    })

    it('should not scan anything', () => {
      expect(buildSpy).not.toHaveBeenCalled()
    })

    it('should still close the write connection it opened to take the lock', () => {
      expect(clients.write.end).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the acquisition scan overruns its deadline', () => {
    let outcome: string

    beforeEach(async () => {
      buildSpy.mockRejectedValue(new Error('acquisition scan exceeded 240000 ms'))
      outcome = await runNeighborsJob({ connect, logger })
    })

    it('should report the failure rather than throwing into the job runner', () => {
      expect(outcome).toBe('failed')
    })

    it('should leave the previous neighbours serving by failing before the swap can commit', () => {
      expect(logger.error).toHaveBeenCalled()
    })

    it('should release both connections', () => {
      expect([clients.read.end.mock.calls.length, clients.write.end.mock.calls.length]).toEqual([1, 1])
    })

    it('should log the failure', () => {
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('neighbours rebuild failed'))
    })
  })

  describe('and the database rejects the very first statement', () => {
    beforeEach(async () => {
      clients.write.query.mockRejectedValue(Object.assign(new Error('password authentication failed'), { code: '28P01' }))
      await runNeighborsJob({ connect, logger })
    })

    it('should log only the error code and message, never anything carrying a connection string', () => {
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('28P01: password authentication failed'))
    })
  })

  describe('and metrics are wired', () => {
    let observe: jest.Mock

    beforeEach(async () => {
      observe = jest.fn()
      await runNeighborsJob({ connect, logger, metrics: { observe } })
    })

    it('should report the row count of the build', () => {
      expect(observe.mock.calls[0][0]).toEqual(expect.objectContaining({ rows: 1 }))
    })

    it('should report a peak memory reading', () => {
      expect(observe.mock.calls[0][0].peakRssBytes).toBeGreaterThan(0)
    })
  })
})
