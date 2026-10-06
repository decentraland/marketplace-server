export class MissingParameterError extends Error {
  constructor(parameter: string) {
    super(`The ${parameter} parameter is required`)
  }
}

export class InvalidParameterError extends Error {
  constructor(parameter: string, value: string) {
    super(`The value of the ${parameter} parameter is invalid: ${value}`)
  }
}
