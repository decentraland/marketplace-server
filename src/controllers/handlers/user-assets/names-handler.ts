import { Params } from '../../../logic/http/params'
import { UserNamesResponse, UserNamesOnlyResponse } from '../../../ports/user-assets/types'
import { HandlerContextWithPath } from '../../../types'
import { getUserAssetsParams, createPaginatedResponse } from '../utils'

/**
 * Handler for GET /v1/users/:address/names
 * Returns complete name/ENS data for a user including contract details and pricing
 */
export async function getUserNamesHandler(
  context: HandlerContextWithPath<'userAssets', '/v1/users/:address/names'>
): Promise<ReturnType<typeof createPaginatedResponse<UserNamesResponse['elements'][0]>>> {
  const { userAssets } = context.components
  const { address } = context.params
  const params = new Params(context.url.searchParams)
  const { first, skip } = getUserAssetsParams(params)

  try {
    const { data, total } = await userAssets.getNamesByOwner(address.toLowerCase(), first, skip)
    return createPaginatedResponse(data, total, first, skip)
  } catch (error) {
    return {
      status: 500,
      body: {
        ok: false,
        message: 'Failed to fetch user names',
        data: error instanceof Error ? { error: error.message } : undefined
      }
    }
  }
}

/**
 * Handler for GET /v1/users/:address/names/names-only
 * Returns minimal name data (name/subdomain only) for profile validation
 */
export async function getUserNamesOnlyHandler(
  context: HandlerContextWithPath<'userAssets', '/v1/users/:address/names/names-only'>
): Promise<ReturnType<typeof createPaginatedResponse<UserNamesOnlyResponse['elements'][0]>>> {
  const { userAssets } = context.components
  const { address } = context.params
  const params = new Params(context.url.searchParams)
  const { first, skip } = getUserAssetsParams(params)

  try {
    const { data, total } = await userAssets.getOwnedNamesOnly(address.toLowerCase(), first, skip)
    return createPaginatedResponse(data, total, first, skip)
  } catch (error) {
    return {
      status: 500,
      body: {
        ok: false,
        message: 'Failed to fetch user names data',
        data: error instanceof Error ? { error: error.message } : undefined
      }
    }
  }
}
