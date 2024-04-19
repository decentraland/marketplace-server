export type IJobComponent = {
  start(): void
  stop(): Promise<void>
}

export type JobOptions = {
  /** Sets if the job will be run repeatedly or once */
  repeat?: boolean
  /** Sets if the job will wait for a specific amount of time in ms before starting for the first time */
  startupDelay?: number
  /** Sets a function to be executed if the job fails */
  onError?: (error: unknown) => void
  /** Executes a function when the component finishes */
  onFinish?: () => any
}
