export class InvalidWertMessageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidWertMessageError'
  }
}
