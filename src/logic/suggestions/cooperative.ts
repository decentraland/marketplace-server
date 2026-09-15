import { setImmediate } from 'node:timers/promises'

/**
 * Hands control back to the event loop mid-computation.
 *
 * The neighbours rebuild runs inside the API process, so every uninterrupted stretch of CPU it spends
 * is a stretch in which no request is served. Splitting that work into slices with a yield between
 * them does not make the job faster -- it makes the process answerable while the job runs, which is
 * the only thing the API's latency cares about.
 *
 * `setImmediate` and not a bare `yield`: a synchronous generator's `yield` returns to its own caller
 * without the event loop ever getting a turn, so the stall is exactly as long with one as without.
 * This resolves on the check phase, after pending I/O callbacks have had theirs.
 */
export async function yieldToEventLoop(): Promise<void> {
  await setImmediate()
}

/**
 * Inner steps between two yields.
 *
 * Small enough that a slice stays in the low tens of milliseconds at production scale, large enough
 * that the yields themselves stay a rounding error on the job's runtime.
 */
export const YIELD_EVERY_STEPS = 2000
