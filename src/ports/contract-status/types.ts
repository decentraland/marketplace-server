import { IBaseComponent } from '@well-known-components/interfaces'

/** A paused off-chain marketplace contract: lowercased address, network in the trades' spelling (ETHEREUM or MATIC). */
export type PausedContract = {
  address: string
  network: string
}

export type DBContractStatus = {
  address: string
  network: string
}

/**
 * In-memory copy of the marketplace contracts the trades indexer reports as paused, refreshed on an interval.
 * Reads never touch the database and never throw.
 */
export interface IContractStatusComponent extends IBaseComponent {
  /**
   * The paused contracts as of the last successful refresh.
   * @returns The paused set; empty before the first successful load.
   */
  getPausedContracts(): PausedContract[]
  /**
   * Reloads the paused set. Never throws: on failure it logs and keeps the last known set.
   */
  refresh(): Promise<void>
}
