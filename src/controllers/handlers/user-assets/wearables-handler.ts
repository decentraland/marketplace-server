import { Params } from '../../../logic/http/params'
import { UserWearablesResponse, UserWearablesUrnTokenResponse, UserGroupedWearablesResponse } from '../../../ports/user-assets/types'
import { HandlerContextWithPath } from '../../../types'
import { getUserAssetsParams, createPaginatedResponse } from '../utils'

/**
 * Handler for GET /v1/users/:address/wearables
 * Returns complete wearable data for a user including metadata, rarity, pricing, etc.
 */
export async function getUserWearablesHandler(
  context: HandlerContextWithPath<'userAssets', '/v1/users/:address/wearables'>
): Promise<ReturnType<typeof createPaginatedResponse<UserWearablesResponse['elements'][0]>>> {
  const { userAssets } = context.components
  const { address } = context.params
  const params = new Params(context.url.searchParams)
  const { first, skip } = getUserAssetsParams(params)

  try {
    const { data, total, totalItems } = await userAssets.getWearablesByOwner(address.toLowerCase(), first, skip)
    return createPaginatedResponse(data, total, first, skip, totalItems)
  } catch (error) {
    return {
      status: 500,
      body: {
        ok: false,
        message: 'Failed to fetch user wearables',
        data: error instanceof Error ? { error: error.message } : undefined
      }
    }
  }
}

/**
 * Handler for GET /v1/users/:address/wearables/urn-token
 * Returns minimal wearable data (URN and token ID only) for profile validation
 */
export async function getUserWearablesUrnTokenHandler(
  context: HandlerContextWithPath<'userAssets', '/v1/users/:address/wearables/urn-token'>
): Promise<ReturnType<typeof createPaginatedResponse<UserWearablesUrnTokenResponse['elements'][0]>>> {
  const { userAssets } = context.components
  const { address } = context.params
  const params = new Params(context.url.searchParams)
  const { first, skip } = getUserAssetsParams(params)

  try {
    const { data, total } = await userAssets.getOwnedWearablesUrnAndTokenId(address.toLowerCase(), first, skip)
    return createPaginatedResponse(data, total, first, skip)
  } catch (error) {
    return {
      status: 500,
      body: {
        ok: false,
        message: 'Failed to fetch user wearables URN tokens',
        data: error instanceof Error ? { error: error.message } : undefined
      }
    }
  }
}

export async function getUserGroupedWearablesHandler(
  context: HandlerContextWithPath<'userAssets', '/v1/users/:address/wearables/grouped'>
): Promise<ReturnType<typeof createPaginatedResponse<UserGroupedWearablesResponse['elements'][0]>>> {
  const { userAssets } = context.components
  const { address } = context.params
  const params = new Params(context.url.searchParams)
  const filters = getUserAssetsParams(params)

  try {
    const { data, total } = await userAssets.getGroupedWearablesByOwner(address.toLowerCase(), filters)
    return createPaginatedResponse(data, total, filters.first, filters.skip)
  } catch (error) {
    return {
      status: 500,
      body: {
        ok: false,
        message: 'Failed to fetch user grouped wearables',
        data: error instanceof Error ? { error: error.message } : undefined
      }
    }
  }
}
