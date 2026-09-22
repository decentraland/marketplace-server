import { Client } from 'pg'
import { asCursorClient, produceNeighborRows, type BuildTimings } from './build-neighbors'
import { ACQUISITION_SCAN_DEADLINE_MS, NEIGHBORS_JOB_STATEMENT_TIMEOUT_MS } from './constants'
import { swapNeighborsTable, type QueryableClient, type RebuildOutcome } from './neighbors-table'

export type NeighborsJobLogger = {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

export type NeighborsJobMetrics = {
  observe: (result: { durationMs: number; rows: number; peakRssBytes: number }) => void
}

export type NeighborsJobDeps = {
  /** Opens a connection OUTSIDE the request pool. The pool caps statements at 40s; the acquisition
   * scan alone runs to 80. */
  connect: (role: 'read' | 'write') => Promise<Client>
  /** Opens a connection to the asset-bundle-registry database, where the co-wear source is computed.
   * Absent, the source is not built. */
  connectProfiles?: () => Promise<Client>
  logger: NeighborsJobLogger
  metrics?: NeighborsJobMetrics
  blockWidth?: number
}

export type NeighborsJobOutcome = RebuildOutcome | 'failed'

/**
 * Rebuilds the item-neighbours table.
 *
 * Runs inside the API process but never on its connections: both clients here are opened for the
 * duration of the job and closed in `finally`, so the service holds no extra connection between runs
 * and a multi-minute scan cannot occupy a request slot.
 *
 * Every replica runs this on the same schedule, so the first thing the write connection does is take a
 * SESSION-scoped advisory lock, before the read connection is even opened — the losers return having
 * touched nothing, rather than three replicas each scanning 5M mint rows to throw two results away. It
 * is session-scoped because the scan and the build both happen before the swap opens its transaction;
 * `finally` is what releases it. `swapNeighborsTable` takes a transaction-scoped lock of its own, which
 * is belt and braces for anything that reaches the swap by another route.
 *
 * A scan that overruns its deadline aborts the whole run and leaves the previous table serving. Stale
 * neighbours are a far smaller problem than a half-built table or a job that never yields its
 * connections back.
 */
export async function runNeighborsJob(deps: NeighborsJobDeps): Promise<NeighborsJobOutcome> {
  const { connect, connectProfiles, logger, metrics } = deps
  const started = Date.now()
  let peakRss = process.memoryUsage().rss
  const sampler = setInterval(() => {
    const rss = process.memoryUsage().rss
    if (rss > peakRss) peakRss = rss
  }, 1000)

  let readClient: Client | undefined
  let writeClient: Client | undefined
  let profilesClient: Client | undefined
  // Set by a connection-level error. The run is abandoned at the next checkpoint rather than carried
  // on with a client that is no longer talking to anything.
  let fatal: unknown
  // Checked INSIDE the swap's transaction, before every insert. Checking only after the swap returns
  // would be checking after COMMIT: the half-built table would already be live, and all the throw could
  // do is mislabel the run. Thrown from inside the producer it unwinds through the swap, which rolls
  // back and leaves the previous neighbours serving.
  const abortIfFatal = () => {
    if (fatal) throw fatal
  }

  try {
    writeClient = await connect('write')
    await configure(writeClient, logger, error => {
      fatal = error
    })

    // Cheapest possible early exit: another replica is already doing this.
    if (!(await tryAcquireAdvisoryLock(writeClient))) {
      logger.info('neighbours rebuild skipped: another replica holds the lock')
      return 'skipped'
    }

    readClient = await connect('read')
    await configure(readClient, logger, error => {
      fatal = error
    })
    await readClient.query('SET default_transaction_read_only = on')

    if (connectProfiles) {
      profilesClient = await openProfilesClient(connectProfiles, logger)
    }

    // The rows are generated INSIDE the swap transaction and inserted in chunks as they appear, so the
    // job never holds the whole ~940k-row set in memory and the live table stays untouched until the
    // rename at the end.
    let timings: BuildTimings | undefined
    let rowsWritten = 0
    abortIfFatal()
    const outcome = await swapNeighborsTable(writeClient as unknown as QueryableClient, async (insert, discard) =>
      produceNeighborRows(
        asCursorClient(readClient as unknown as QueryableClient),
        async rows => {
          abortIfFatal()
          rowsWritten += rows.length
          await insert(rows)
        },
        {
          blockWidth: deps.blockWidth,
          acquisitionDeadlineMs: ACQUISITION_SCAN_DEADLINE_MS,
          worn: profilesClient && {
            client: asCursorClient(profilesClient as unknown as QueryableClient),
            discard: () => discard('worn')
          }
        },
        t => {
          timings = t
        }
      )
    )

    abortIfFatal()

    if (timings?.wornError) {
      logger.warn(`neighbours rebuild went ahead without the co-wear source: ${message(timings.wornError)}`)
    }

    const durationMs = Date.now() - started
    logger.info(
      `neighbours rebuild ${outcome}: ${rowsWritten} rows over ${timings?.walletsSeen ?? 0} wallets ` +
        `and ${timings?.rowsRead ?? 0} acquisitions in ${durationMs} ms ` +
        `[catalogue ${timings?.catalogueMs ?? 0} ms, acquisitions ${timings?.acquisitionsMs ?? 0} ms, ` +
        `co-ownership ${timings?.coOwnershipMs ?? 0} ms, content ${timings?.contentMs ?? 0} ms, worn ${timings?.wornMs ?? 0} ms, ` +
        `peak rss ${Math.round(peakRss / 1048576)} MB]`
    )
    metrics?.observe({ durationMs, rows: rowsWritten, peakRssBytes: peakRss })
    return outcome
  } catch (error) {
    logger.error(`neighbours rebuild failed after ${Date.now() - started} ms: ${message(error)}`)
    return 'failed'
  } finally {
    clearInterval(sampler)
    await Promise.all([close(readClient, logger), close(writeClient, logger), close(profilesClient, logger)])
  }
}

/**
 * The registry connection is the one connection whose loss is NOT fatal: without it the rebuild still
 * swaps in co-ownership and content, so a failure to open it, or its dropping later, only costs the
 * co-wear source.
 */
async function openProfilesClient(connectProfiles: () => Promise<Client>, logger: NeighborsJobLogger): Promise<Client | undefined> {
  let client: Client | undefined
  try {
    client = await connectProfiles()
    await configure(client, logger, () => undefined)
    await client.query('SET default_transaction_read_only = on')
    return client
  } catch (error) {
    logger.warn(`could not open the co-wear connection, building without it: ${message(error)}`)
    await close(client, logger)
    return undefined
  }
}

/**
 * The lock is held for the rest of the session rather than a transaction, because the read and the
 * build happen before the swap opens its own transaction. Releasing it with the connection is what
 * `finally` guarantees.
 */
async function tryAcquireAdvisoryLock(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ acquired: boolean }>(`SELECT pg_try_advisory_lock(${REBUILD_SESSION_LOCK_KEY}) AS acquired`)
  return rows[0]?.acquired === true
}

/** Distinct from the transaction-scoped key the swap uses: this one guards the whole run. */
const REBUILD_SESSION_LOCK_KEY = 8_421_312

/**
 * Prepares one of the job's own connections.
 *
 * The error listener is not optional. node-postgres emits `error` on the CLIENT for anything the
 * backend raises outside a query — a failover, an idle connection cut, an administrative termination —
 * and these two clients spend most of the job idle while the other one works, which is exactly when
 * that happens. An `error` event with no listener is an unhandled EventEmitter error, and that takes
 * the whole API process down, not just the rebuild. The job's try/catch cannot help: the event is
 * raised outside its promise chain.
 */
async function configure(client: Client, logger: NeighborsJobLogger, onFatal: (error: unknown) => void): Promise<void> {
  client.on('error', error => {
    logger.error(`neighbours job connection lost: ${message(error)}`)
    onFatal(error)
  })
  await client.query(`SET statement_timeout = ${NEIGHBORS_JOB_STATEMENT_TIMEOUT_MS}`)
}

async function close(client: Client | undefined, logger: NeighborsJobLogger): Promise<void> {
  if (!client) return
  try {
    await client.end()
  } catch (error) {
    logger.warn(`could not close a neighbours job connection: ${message(error)}`)
  }
}

/** Never let a pg error reach a log with its connection string attached. */
function message(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { code?: string; message?: string }
    return `${e.code ?? 'ERR'}: ${e.message ?? 'unknown database error'}`
  }
  return 'unknown error'
}
