import { START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { isErrorWithMessage } from '../../logic/errors'
import { getPausedContractKey } from '../../logic/trades/contract-status'
import { fromSquidNetwork } from '../../logic/trades/squid-network'
import { AppComponents } from '../../types'
import { getPausedContractsQuery } from './queries'
import { DBContractStatus, IContractStatusComponent, PausedContract } from './types'

export const DEFAULT_CONTRACT_STATUS_REFRESH_INTERVAL_MS = 30_000

/**
 * Creates the paused-contracts cache.
 *
 * 1. On start, loads the paused rows of squid_trades.contract_status.
 * 2. Reloads them every CONTRACT_STATUS_REFRESH_INTERVAL_MS (30s by default).
 * 3. On a failed reload, keeps the last known set and logs.
 *
 * @param components - The read database, config and logs.
 * @returns The contract status component.
 */
export async function createContractStatusComponent(
  components: Pick<AppComponents, 'dappsDatabase' | 'config' | 'logs'>
): Promise<IContractStatusComponent> {
  const { dappsDatabase, config, logs } = components
  const logger = logs.getLogger('contract-status')
  const refreshIntervalMs = (await config.getNumber('CONTRACT_STATUS_REFRESH_INTERVAL_MS')) ?? DEFAULT_CONTRACT_STATUS_REFRESH_INTERVAL_MS

  let pausedContracts: PausedContract[] = []
  let pausedKeys = new Set<string>()
  let interval: ReturnType<typeof setInterval> | undefined

  async function refresh(): Promise<void> {
    try {
      const result = await dappsDatabase.query<DBContractStatus>(getPausedContractsQuery())
      pausedContracts = result.rows.map(row => ({ address: row.address.toLowerCase(), network: fromSquidNetwork(row.network) }))
      pausedKeys = new Set(pausedContracts.map(({ address, network }) => getPausedContractKey(address, network)))
    } catch (error) {
      logger.error('Failed to refresh the paused marketplace contracts, keeping the last known set', {
        error: isErrorWithMessage(error) ? error.message : 'Unknown error',
        pausedContracts: pausedContracts.length
      })
    }
  }

  function getPausedContracts(): PausedContract[] {
    return pausedContracts
  }

  function isPaused(address: string, network: string): boolean {
    return pausedKeys.has(getPausedContractKey(address, network))
  }

  async function start(): Promise<void> {
    await refresh()
    // refresh() never rejects; the catch only keeps the promise from floating.
    interval = setInterval(() => {
      refresh().catch(() => undefined)
    }, refreshIntervalMs)
    interval.unref?.()
  }

  async function stop(): Promise<void> {
    if (interval) {
      clearInterval(interval)
      interval = undefined
    }
  }

  return {
    [START_COMPONENT]: start,
    [STOP_COMPONENT]: stop,
    getPausedContracts,
    isPaused,
    refresh
  }
}
