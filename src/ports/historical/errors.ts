/** The block is too recent for the indexers to be sure to hold it yet. */
export class BlockTooRecentError extends Error {
  constructor(public block: number) {
    super(`Block ${block} is too recent to read holdings at; try again in a few minutes`)
  }
}

/** Too many reads of past holdings are already running or waiting. */
export class HistoricalBusyError extends Error {
  constructor() {
    super('Too many reads of past holdings are running; try again in a moment')
  }
}
