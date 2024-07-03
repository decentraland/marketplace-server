import { Trade, TradeCreation } from '@dcl/schemas'
import { DBTrade } from '../../ports/trades'
import {
  DuplicatedBidError,
  InvalidTradeSignatureError,
  InvalidTradeStructureError,
  TradeAlreadyExpiredError,
  TradeEffectiveAfterExpirationError
} from '../../ports/trades/errors'
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
    if (
      e instanceof TradeAlreadyExpiredError ||
      e instanceof TradeEffectiveAfterExpirationError ||
      e instanceof InvalidTradeStructureError ||
      e instanceof InvalidTradeSignatureError
    ) {
      return {
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: e.message
        }
      }
    }

    if (e instanceof DuplicatedBidError) {
      return {
        status: StatusCode.CONFLICT,
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
        message: typeof e === 'object' && e && 'message' in e && typeof e.message === 'string' ? e.message : 'Trade could not be created'
      }
    }
  }
}
