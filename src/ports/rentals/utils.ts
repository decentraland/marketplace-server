import { IFetchComponent } from '@well-known-components/interfaces'
import pLimit from 'p-limit'
import { PaginatedResponse } from '@dcl/schemas'
import { HTTPSuccessResponseBody } from '../../types'
import { FetchRentalListingsError } from './errors'

export const MAX_CONCURRENT_REQUEST = 5
export const MAX_URL_LENGTH = 2048

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
            throw new FetchRentalListingsError(response)
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
