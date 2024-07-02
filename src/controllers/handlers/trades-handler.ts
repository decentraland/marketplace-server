import { Trade, TradeCreation } from '@dcl/schemas'
import { DBTrade } from '../../ports/trades'
import { HTTPResponse, HandlerContextWithPath, StatusCode } from '../../types'
import { RequestError } from '../../utils'

export async function getTradesHandler(
  context: Pick<HandlerContextWithPath<'trades', '/v1/trades'>, 'components'>
): Promise<HTTPResponse<{ data: DBTrade[]; count: number }>> {
  const {
    components: { trades }
  } = context

  const { data, count } = await trades.getTrades()

  return {
    status: StatusCode.OK,
    body: {
      ok: true,
      data: {
        data,
        count
      }
    }
  }
}

export async function addTradeHandler(
  context: Pick<HandlerContextWithPath<'trades', '/v1/trades'>, 'components' | 'request' | 'verification'>
): Promise<HTTPResponse<Trade>> {
  const {
    request,
    components: { trades },
    verification
  } = context

  const signer = verification?.auth
  if (!signer) {
    return {
      status: StatusCode.UNAUTHORIZED,
      body: {
        ok: false,
        message: 'Unauthorized'
      }
    }
  }

  const body: TradeCreation = await request.json()

  try {
    const data = await trades.addTrade(body, signer)

    return {
      status: StatusCode.CREATED,
      body: {
        ok: true,
        data
      }
    }
  } catch (e) {
    if (e instanceof RequestError) {
      return {
        status: e.statusCode,
        body: {
          ok: false,
          message: e.message
        }
      }
    }

    return {
      status: StatusCode.BAD_REQUEST,
      body: {
        ok: false,
        message: 'Trade could not be created'
      }
    }
  }
}
