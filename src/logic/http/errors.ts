export class InvalidParameterError extends Error {
  constructor(parameter: string, value: string) {
    super(`The value of the ${parameter} parameter is invalid: ${value}`)
  }
}
