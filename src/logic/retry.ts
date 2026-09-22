export type RetryOptions = {
  /** Injected by tests so a retry schedule can be asserted without waiting it out. */
  sleep?: (ms: number) => Promise<void>
  onRetry?: (error: unknown, delayMs: number, attempt: number) => void
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Runs `attempt` until it resolves, waiting `delaysMs[i]` before retry `i + 1`; so `[1000, 4000]` means three
 * tries in all. The last failure is what the caller gets.
 */
export async function withRetries<T>(attempt: () => Promise<T>, delaysMs: number[], options: RetryOptions = {}): Promise<T> {
  const sleep = options.sleep ?? wait
  for (let retry = 0; ; retry++) {
    try {
      return await attempt()
    } catch (error) {
      if (retry >= delaysMs.length) throw error
      options.onRetry?.(error, delaysMs[retry], retry + 1)
      await sleep(delaysMs[retry])
    }
  }
}
