import { BidSortBy, Bid } from '@dcl/schemas'
import { isErrorWithMessage } from '../../logic/errors'
import { PaginatedResponse, getPaginationParams, getParameter } from '../../logic/http'
import { InvalidParameterError } from '../../logic/http/errors'
import { HTTPResponse, HandlerContextWithPath, StatusCode } from '../../types'

export async function getBidsHandler(
  context: Pick<HandlerContextWithPath<'bids', '/v1/bids'>, 'components' | 'url'>
): Promise<HTTPResponse<PaginatedResponse<Bid>>> {
  try {
    const {
      components: { bids },
      url
    } = context

    const { limit, offset } = getPaginationParams(url.searchParams)
    const bidder = getParameter('bidder', url.searchParams)
    const sortBy = getParameter('sortBy', url.searchParams, Object.values(BidSortBy))

    const { data, count } = await bids.getBids({ limit, offset, bidder, sortBy })

    return {
      status: StatusCode.OK,
      body: {
        ok: true,
        data: {
          results: data,
          total: count,
          page: Math.floor(offset / limit),
          pages: data.length > 0 ? Math.ceil(count / limit) : 0,
          limit
        }
      }
    }
  } catch (e) {
    if (e instanceof InvalidParameterError) {
      return {
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: e.message
        }
      }
    }

    return {
      status: StatusCode.ERROR,
      body: {
        ok: false,
        message: isErrorWithMessage(e) ? e.message : 'Could not fetch bids'
      }
    }
  }
}
