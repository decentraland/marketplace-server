import { InvalidParameterError } from './errors'

const MAX_LIMIT = 100
const DEFAULT_PAGE = 0

export const getPaginationParams = (params: URLSearchParams): { limit: number; offset: number } => {
  const limit = params.get('limit')
  const offset = params.get('offset')
  const page = params.get('page')
  const parsedLimit = parseInt(limit as string, 10)
  const parsedPage = parseInt(page as string, 10)
  const parsedOffset = parseInt(offset as string, 10)

  const paginationLimit = limit && !isNaN(parsedLimit) && parsedLimit <= MAX_LIMIT && parsedLimit > 0 ? parsedLimit : MAX_LIMIT
  const paginationOffset = isNaN(parsedOffset)
    ? (page && !isNaN(parsedPage) && parsedPage >= 0 ? parsedPage : DEFAULT_PAGE) * paginationLimit
    : parsedOffset

  return {
    limit: paginationLimit,
    offset: paginationOffset
  }
}

export function getParameter<T = string>(parameterName: string, params: URLSearchParams, values?: T[]): T | undefined {
  const parameter = params.get(parameterName) as T | null

  if (values && parameter && !values.includes(parameter as T)) {
    throw new InvalidParameterError(parameterName, (parameter as any).toString())
  }

  return parameter === null ? undefined : parameter
}

export function getNumberParameter(parameterName: string, params: URLSearchParams): number | undefined {
  const parameter = getParameter(parameterName, params)

  if (!parameter) return undefined

  const valueAsNumber = Number.parseInt(parameter)
  if (Number.isNaN(valueAsNumber)) {
    throw new InvalidParameterError(parameterName, parameter)
  }

  return valueAsNumber
}

/**
 * Reads an optional non-negative integer query parameter, rejecting partial or fractional input.
 * @throws InvalidParameterError if the value is not a non-negative safe integer.
 */
export function getNonNegativeIntegerParameter(parameterName: string, params: URLSearchParams): number | undefined {
  const value = params.get(parameterName)
  if (value === null) return undefined
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new InvalidParameterError(parameterName, value)
  }
  return Number(value)
}
