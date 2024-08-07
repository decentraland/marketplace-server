import { IFetchComponent } from '@well-known-components/http-server'
import { Response } from 'node-fetch'
import pLimit from 'p-limit'
import { Network } from '@dcl/schemas'
import { DBNetwork } from './ports/bids'
import { HTTPErrorResponseBody, HTTPSuccessResponseBody, PaginatedResponse, SquidNetwork, StatusCode } from './types'

export const MAX_CONCURRENT_REQUEST = 5
export const MAX_URL_LENGTH = 2048

export async function processRequestError(action: string, response: Response) {
  let parsedErrorResult: HTTPErrorResponseBody<unknown> | undefined

  try {
    parsedErrorResult = await response.json()
  } catch (_) {
    // Ignore the JSON parse result error error.
  }

  if (parsedErrorResult) {
    throw new Error(parsedErrorResult.message)
  }

  throw new Error(`Error ${action}, the server responded with: ${response.status}`)
}

export function isPaginated<T>(data: T | PaginatedResponse<T>): data is PaginatedResponse<T> {
  return (data as PaginatedResponse<T>).results !== undefined
}

export async function queryMultipleTimesWhenExceedingUrlLimit<T>(
  baseUrl: string,
  queryParameterName: string,
  queryParameterValues: string[],
  fetchComponent: IFetchComponent
): Promise<T[]> {
  const limit = pLimit(MAX_CONCURRENT_REQUEST)

  // Build URLs to get all the queried results
  const urls: string[] = []
  let url = baseUrl

  const alreadyHasQueryParams = baseUrl.includes('?')

  if (!alreadyHasQueryParams) {
    url += '?'
  }

  queryParameterValues.forEach((value, i) => {
    const param = `${queryParameterName}=${value}`

    if (url.length < MAX_URL_LENGTH) {
      url += i === 0 && !alreadyHasQueryParams ? param : `&${param}`
    } else {
      urls.push(url)
      url = baseUrl + (!alreadyHasQueryParams ? '?' : '&') + param
    }
  })

  // Push the last url
  if (url !== baseUrl) {
    urls.push(url)
  }

  const results: HTTPSuccessResponseBody<T | PaginatedResponse<T>>[] = await Promise.all(
    urls.map(url =>
      limit(async () => {
        try {
          const response = await fetchComponent.fetch(url)
          if (!response.ok) {
            await processRequestError('fetching favorites', response)
          }

          const parsedResult = await response.json()
          if (!parsedResult.ok) {
            throw new Error(parsedResult.message)
          }

          return parsedResult
        } catch (error) {
          limit.clearQueue()
          throw error
        }
      })
    )
  )

  return results.flatMap(({ data }) => (isPaginated(data) ? data.results : data))
}

export class RequestError extends Error {
  constructor(public statusCode: StatusCode, public message: string) {
    super(message)
  }
}

export function getDBNetworks(network: Network): DBNetwork[] {
  if (network === Network.ETHEREUM) {
    return [Network.ETHEREUM, SquidNetwork.ETHEREUM]
  }

  if (network === Network.MATIC) {
    return [Network.MATIC, SquidNetwork.POLYGON]
  }

  return []
}
