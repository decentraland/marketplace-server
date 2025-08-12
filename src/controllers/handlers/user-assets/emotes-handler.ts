import { Params } from '../../../logic/http/params'
import { UserEmotesResponse, UserEmotesUrnTokenResponse, UserGroupedEmotesResponse } from '../../../ports/user-assets/types'
import { HandlerContextWithPath } from '../../../types'
import { getUserAssetsParams, createPaginatedResponse } from '../utils'

/**
 * Handler for GET /v1/users/:address/emotes
 * Returns complete emote data for a user including metadata, rarity, pricing, etc.
 */
export async function getUserEmotesHandler(
  context: HandlerContextWithPath<'userAssets', '/v1/users/:address/emotes'>
): Promise<ReturnType<typeof createPaginatedResponse<UserEmotesResponse['elements'][0]>>> {
  const { userAssets } = context.components
  const { address } = context.params
  const params = new Params(context.url.searchParams)
  const { first, skip } = getUserAssetsParams(params)

  try {
    const { data, total, totalItems } = await userAssets.getEmotesByOwner(address.toLowerCase(), first, skip)
    return createPaginatedResponse(data, total, first, skip, totalItems)
  } catch (error) {
    return {
      status: 500,
      body: {
        ok: false,
        message: 'Failed to fetch user emotes',
        data: error instanceof Error ? { error: error.message } : undefined
      }
    }
  }
}

/**
 * Handler for GET /v1/users/:address/emotes/urn-token
 * Returns minimal emote data (URN and token ID only) for profile validation
 */
export async function getUserEmotesUrnTokenHandler(
  context: HandlerContextWithPath<'userAssets', '/v1/users/:address/emotes/urn-token'>
): Promise<ReturnType<typeof createPaginatedResponse<UserEmotesUrnTokenResponse['elements'][0]>>> {
  const { userAssets } = context.components
  const { address } = context.params
  const params = new Params(context.url.searchParams)
  const { first, skip } = getUserAssetsParams(params)

  try {
    const { data, total } = await userAssets.getOwnedEmotesUrnAndTokenId(address.toLowerCase(), first, skip)
    return createPaginatedResponse(data, total, first, skip)
  } catch (error) {
    return {
      status: 500,
      body: {
        ok: false,
        message: 'Failed to fetch user emotes URN tokens',
        data: error instanceof Error ? { error: error.message } : undefined
      }
    }
  }
}

export async function getUserGroupedEmotesHandler(
  context: HandlerContextWithPath<'userAssets', '/v1/users/:address/emotes/grouped'>
): Promise<ReturnType<typeof createPaginatedResponse<UserGroupedEmotesResponse['elements'][0]>>> {
  const { userAssets } = context.components
  const { address } = context.params
  const params = new Params(context.url.searchParams)
  const filters = getUserAssetsParams(params)

  try {
    const { data, total } = await userAssets.getGroupedEmotesByOwner(address.toLowerCase(), filters)
    return createPaginatedResponse(data, total, filters.first, filters.skip)
  } catch (error) {
    return {
      status: 500,
      body: {
        ok: false,
        message: 'Failed to fetch user grouped emotes',
        data: error instanceof Error ? { error: error.message } : undefined
      }
    }
  }
}
