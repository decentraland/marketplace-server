export class TopOwnersTimeoutError extends Error {
  constructor(public creator: string) {
    super(`The owners of ${creator} could not be aggregated in time`)
  }
}
