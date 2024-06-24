import { AddTradeRequestBody, DBTrade } from '../../ports/trades'
import { HTTPResponse, HandlerContextWithPath, StatusCode } from '../../types'

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
): Promise<HTTPResponse<DBTrade>> {
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

  const body: AddTradeRequestBody = await request.json()

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
    console.error(e)
    return {
      status: StatusCode.BAD_REQUEST,
      body: {
        ok: false,
        message: 'Unexpected error'
      }
    }
  }
}
