import { fromDBGetPickByItemIdToPickUserAddressesWithCount, fromDBPickStatsToPickStats, TPick } from '../../../adapters/picks'
import { isEthereumAddressValid } from '../../../logic/ethereum/validations'
import { getNumberParameter, getPaginationParams } from '../../../logic/http'
import { InvalidParameterError } from '../../../logic/http/errors'
import { ListsNotFoundError } from '../../../ports/favorites/lists/errors'
import { PickStats, PickUnpickInBulkBody, PickUnpickInBulkResponse } from '../../../ports/favorites/picks'
import { ItemNotFoundError } from '../../../ports/items/errors'
import { HandlerContextWithPath, HTTPResponse, StatusCode } from '../../../types'

export async function getPickStatsOfItemHandler(
  context: Pick<HandlerContextWithPath<'picks', '/v1/picks/:itemId/stats'>, 'url' | 'components' | 'params' | 'request' | 'verification'>
): Promise<HTTPResponse<PickStats>> {
  const {
    url,
    components: { picks },
    verification,
    params
  } = context
  const userAddress: string | undefined = verification?.auth.toLowerCase()

  try {
    const power = getNumberParameter('power', url.searchParams)

    const pickStats = await picks.getPicksStats([params.itemId], {
      userAddress,
      power
    })

    return {
      status: StatusCode.OK,
      body: {
        ok: true,
        data: fromDBPickStatsToPickStats(pickStats[0])
      }
    }
  } catch (error) {
    if (error instanceof InvalidParameterError) {
      return {
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: error.message
        }
      }
    }

    throw error
  }
}

export async function getPickStatsHandler(
  context: Pick<HandlerContextWithPath<'picks', '/v1/picks/stats'>, 'url' | 'components'>
): Promise<HTTPResponse<PickStats[]>> {
  const {
    url,
    components: { picks }
  } = context

  try {
    const power = getNumberParameter('power', url.searchParams) ?? undefined
    const itemIds = url.searchParams.getAll('itemId')
    const userAddress = url.searchParams.get('checkingUserAddress')?.toLowerCase() ?? undefined

    if (userAddress && !isEthereumAddressValid(userAddress)) {
      return {
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: 'The checking user address parameter must be an Ethereum Address.'
        }
      }
    }

    if (!itemIds.length) {
      return {
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: 'The request must include at least one item id.'
        }
      }
    }

    const pickStats = await picks.getPicksStats(itemIds, { userAddress, power })

    return {
      status: StatusCode.OK,
      body: {
        ok: true,
        data: pickStats.map(fromDBPickStatsToPickStats)
      }
    }
  } catch (error) {
    if (error instanceof InvalidParameterError) {
      return {
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: error.message
        }
      }
    }

    throw error
  }
}

export async function getPicksByItemIdHandler(
  context: Pick<HandlerContextWithPath<'picks', '/v1/picks/:itemId'>, 'url' | 'components' | 'params' | 'request' | 'verification'>
): Promise<HTTPResponse<Pick<TPick, 'userAddress'>>> {
  const {
    url,
    components: { picks },
    params,
    verification
  } = context

  const userAddress: string | undefined = verification?.auth.toLowerCase()

  const { limit, offset } = getPaginationParams(url.searchParams)

  try {
    const power = getNumberParameter('power', url.searchParams)
    const picksByItemIdResult = await picks.getPicksByItemId(params.itemId, {
      limit,
      offset,
      power,
      userAddress
    })
    const { picks: results, count } = fromDBGetPickByItemIdToPickUserAddressesWithCount(picksByItemIdResult)

    return {
      status: StatusCode.OK,
      body: {
        ok: true,
        data: {
          results,
          total: results.length > 0 ? count : 0,
          page: Math.floor(offset / limit),
          pages: results.length > 0 ? Math.ceil(count / limit) : 0,
          limit
        }
      }
    }
  } catch (error) {
    if (error instanceof InvalidParameterError) {
      return {
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: error.message
        }
      }
    }

    throw error
  }
}

export async function pickAndUnpickInBulkHandler(
  context: Pick<HandlerContextWithPath<'picks', '/v1/picks/:itemId'>, 'components' | 'params' | 'request' | 'verification'>
): Promise<HTTPResponse<PickUnpickInBulkResponse>> {
  const {
    components: { picks },
    verification,
    params,
    request
  } = context
  const userAddress: string | undefined = verification?.auth.toLowerCase()

  if (!userAddress) {
    return {
      status: StatusCode.UNAUTHORIZED,
      body: {
        ok: false,
        message: 'Unauthorized'
      }
    }
  }

  const body: PickUnpickInBulkBody = await request.json()

  const { pickedFor, unpickedFrom } = body
  if (pickedFor?.some(listId => unpickedFrom?.includes(listId)) || unpickedFrom?.some(listId => pickedFor?.includes(listId))) {
    return {
      status: StatusCode.BAD_REQUEST,
      body: {
        ok: false,
        message: 'The item cannot be be picked and unpicked from a list at the same time.'
      }
    }
  }

  try {
    await picks.pickAndUnpickInBulk(params.itemId, body, userAddress)
    let pickedByUser = pickedFor && pickedFor?.length > 0

    if (!pickedByUser) {
      const picksStats = await picks.getPicksStats([params.itemId], { userAddress })
      pickedByUser = fromDBPickStatsToPickStats(picksStats[0]).pickedByUser
    }

    return {
      status: StatusCode.OK,
      body: {
        ok: true,
        data: {
          pickedByUser
        }
      }
    }
  } catch (error) {
    if (error instanceof ListsNotFoundError) {
      return {
        status: StatusCode.NOT_FOUND,
        body: {
          ok: false,
          message: error.message,
          data: {
            listIds: error.listIds
          }
        }
      }
    } else if (error instanceof ItemNotFoundError) {
      return {
        status: StatusCode.NOT_FOUND,
        body: {
          ok: false,
          message: error.message,
          data: {
            itemId: error.itemId
          }
        }
      }
    }

    throw error
  }
}
