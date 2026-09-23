import * as buildNeighbors from '../../src/logic/suggestions/build-neighbors'
import * as neighborsTable from '../../src/logic/suggestions/neighbors-table'
import { runNeighborsJob, type NeighborsJobLogger } from '../../src/logic/suggestions/run-neighbors-job'

type FakeClient = { query: jest.Mock; end: jest.Mock; on: jest.Mock; emit: (event: string, payload: unknown) => void }

describe('when running the item neighbours job', () => {
  let logger: NeighborsJobLogger
  let clients: Record<'read' | 'write', FakeClient>
  let connect: jest.Mock
  let profilesClient: { query: jest.Mock; release: jest.Mock }
  let profilesPool: { connect: jest.Mock }
  let lockAcquired: boolean
  let buildSpy: jest.SpyInstance

  function makeClient(): FakeClient {
    const listeners: Record<string, ((payload: unknown) => void)[]> = {}
    return {
      query: jest.fn(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: lockAcquired }] }
        return { rows: [] }
      }),
      end: jest.fn(async () => undefined),
      on: jest.fn((event: string, listener: (payload: unknown) => void) => {
        listeners[event] = [...(listeners[event] ?? []), listener]
      }),
      emit: (event, payload) => (listeners[event] ?? []).forEach(listener => listener(payload))
    }
  }

  beforeEach(() => {
    lockAcquired = true
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    clients = { read: makeClient(), write: makeClient() }
    connect = jest.fn(async (role: 'read' | 'write') => clients[role])
    profilesClient = { query: jest.fn(async () => ({ rows: [] })), release: jest.fn() }
    profilesPool = { connect: jest.fn(async () => profilesClient) }
    buildSpy = jest.spyOn(buildNeighbors, 'produceNeighborRows').mockImplementation(async (_client, insert, _options, onTimings) => {
      await insert([{ itemId: '0xa-1', source: 'cf', neighborId: '0xb-2', sim: 0.5, support: 7, rank: 0 }])
      onTimings?.({ catalogueMs: 1, acquisitionsMs: 2, coOwnershipMs: 3, contentMs: 4, wornMs: 0, walletsSeen: 10, rowsRead: 20 })
      return { cfRows: 1, contentRows: 0, wornRows: 0, itemsCovered: 1, durationMs: 5 }
    })
    // The real swap is what drives the producer, so it is stubbed to run it and report success.
    jest.spyOn(neighborsTable, 'swapNeighborsTable').mockImplementation(async (_client, produce) => {
      await produce(
        async () => undefined,
        async () => undefined
      )
      return 'rebuilt'
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('and the advisory lock is acquired', () => {
    let outcome: string

    beforeEach(async () => {
      outcome = await runNeighborsJob({ connect, profilesPool, logger })
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

    it('should listen for connection errors on both clients, since an unhandled one would take the process down', () => {
      expect([clients.read.on, clients.write.on].map(on => on.mock.calls.map(([event]) => event))).toEqual([['error'], ['error']])
    })
  })

  describe('and another replica already holds the advisory lock', () => {
    let outcome: string

    beforeEach(async () => {
      lockAcquired = false
      outcome = await runNeighborsJob({ connect, profilesPool, logger })
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
      outcome = await runNeighborsJob({ connect, profilesPool, logger })
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
      await runNeighborsJob({ connect, profilesPool, logger })
    })

    it('should log only the error code and message, never anything carrying a connection string', () => {
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('28P01: password authentication failed'))
    })
  })

  describe('and a connection is lost while the scan is running', () => {
    let outcome: string

    beforeEach(async () => {
      buildSpy.mockImplementation(async () => {
        clients.read.emit('error', Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }))
        return { cfRows: 1, contentRows: 0, wornRows: 0, itemsCovered: 1, durationMs: 5 }
      })
      outcome = await runNeighborsJob({ connect, profilesPool, logger })
    })

    it('should report the failure rather than letting the error reach the process as an unhandled event', () => {
      expect(outcome).toBe('failed')
    })

    it('should name the lost connection in the log', () => {
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('neighbours job connection lost'))
    })

    it('should abandon the run rather than report a rebuild it can no longer vouch for', () => {
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('neighbours rebuild rebuilt'))
    })
  })

  describe('and a connection is lost before the first batch is inserted', () => {
    let outcome: string
    let inserted: number
    let committed: boolean

    beforeEach(async () => {
      inserted = 0
      committed = false
      // A stand-in, so what follows is about the JOB's control flow and not about Postgres: it records
      // whether the producer got as far as handing over a row, and whether the swap ran to completion.
      // That the transaction then rolls back is the swap's own behaviour, covered against real Postgres
      // in the integration spec -- nothing here proves it.
      jest.spyOn(neighborsTable, 'swapNeighborsTable').mockImplementation(async (_client, produce) => {
        await produce(
          async rows => {
            inserted += rows.length
          },
          async () => undefined
        )
        committed = true
        return 'rebuilt'
      })
      buildSpy.mockImplementation(async (_client, insert) => {
        clients.write.emit('error', Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }))
        await insert([{ itemId: '0xa-1', source: 'cf', neighborId: '0xb-2', sim: 0.5, support: 7, rank: 0 }])
        return { cfRows: 1, contentRows: 0, wornRows: 0, itemsCovered: 1, durationMs: 5 }
      })
      outcome = await runNeighborsJob({ connect, profilesPool, logger })
    })

    it('should report the failure', () => {
      expect(outcome).toBe('failed')
    })

    it('should hand no rows to the swap, so there is nothing half-built for it to commit', () => {
      expect(inserted).toBe(0)
    })

    it('should abort inside the swap rather than after it, which is what leaves the commit unreached', () => {
      expect(committed).toBe(false)
    })
  })

  describe('and metrics are wired', () => {
    let observe: jest.Mock

    beforeEach(async () => {
      observe = jest.fn()
      await runNeighborsJob({ connect, profilesPool, logger, metrics: { observe } })
    })

    it('should report the row count of the build', () => {
      expect(observe.mock.calls[0][0]).toEqual(expect.objectContaining({ rows: 1 }))
    })

    it('should report a peak memory reading', () => {
      expect(observe.mock.calls[0][0].peakRssBytes).toBeGreaterThan(0)
    })
  })

  describe('and the registry pool hands out a connection', () => {
    let outcome: string

    beforeEach(async () => {
      outcome = await runNeighborsJob({ connect, profilesPool, logger })
    })

    it('should report that it rebuilt the table', () => {
      expect(outcome).toBe('rebuilt')
    })

    it('should read the registry inside a read-only transaction', () => {
      expect(profilesClient.query).toHaveBeenCalledWith('BEGIN TRANSACTION READ ONLY')
    })

    it('should hand the build a co-wear source', () => {
      expect(buildSpy.mock.calls[0][2]?.worn).toEqual(expect.objectContaining({ client: expect.anything(), discard: expect.any(Function) }))
    })

    it('should close the transaction and hand the connection back to the pool intact', () => {
      expect([profilesClient.query.mock.calls.at(-1)?.[0], profilesClient.release.mock.calls]).toEqual(['ROLLBACK', [[false]]])
    })
  })

  describe('and the registry pool cannot hand out a connection', () => {
    let outcome: string

    beforeEach(async () => {
      profilesPool.connect.mockRejectedValue(Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }))
      outcome = await runNeighborsJob({ connect, profilesPool, logger })
    })

    it('should still rebuild the table from the other sources', () => {
      expect(outcome).toBe('rebuilt')
    })

    it('should build without a co-wear source', () => {
      expect(buildSpy.mock.calls[0][2]?.worn).toBeUndefined()
    })

    it('should warn that it went without it', () => {
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('could not open the co-wear connection'))
    })
  })

  describe('and the registry connection cannot close its transaction', () => {
    beforeEach(async () => {
      profilesClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'ROLLBACK') throw new Error('Connection terminated unexpectedly')
        return { rows: [] }
      })
      await runNeighborsJob({ connect, profilesPool, logger })
    })

    it('should destroy the connection rather than hand it to the next borrower', () => {
      expect(profilesClient.release).toHaveBeenCalledWith(true)
    })
  })

  describe('and the co-wear source fails during the build', () => {
    let outcome: string

    beforeEach(async () => {
      buildSpy.mockImplementation(async (_client, insert, _options, onTimings) => {
        await insert([{ itemId: '0xa-1', source: 'cf', neighborId: '0xb-2', sim: 0.5, support: 7, rank: 0 }])
        onTimings?.({
          catalogueMs: 1,
          acquisitionsMs: 2,
          coOwnershipMs: 3,
          contentMs: 4,
          wornMs: 5,
          wornError: Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }),
          walletsSeen: 10,
          rowsRead: 20
        })
        return { cfRows: 1, contentRows: 0, wornRows: 0, itemsCovered: 1, durationMs: 5 }
      })
      outcome = await runNeighborsJob({ connect, profilesPool, logger })
    })

    it('should still report the rebuild', () => {
      expect(outcome).toBe('rebuilt')
    })

    it('should warn with the registry error', () => {
      expect(logger.warn).toHaveBeenCalledWith(
        'neighbours rebuild went ahead without the co-wear source: 57014: canceling statement due to statement timeout'
      )
    })
  })
})
