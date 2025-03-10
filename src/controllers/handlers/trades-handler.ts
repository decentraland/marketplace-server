import { Trade, TradeCreation, Event } from '@dcl/schemas'
import { isErrorWithMessage } from '../../logic/errors'
import { getNumberParameter, getParameter } from '../../logic/http'
import { DBTrade } from '../../ports/trades'
import {
  DuplicatedBidError,
  InvalidECDSASignatureError,
  EventNotGeneratedError,
  InvalidTradeSignatureError,
  InvalidTradeSignerError,
  InvalidTradeStructureError,
  TradeAlreadyExpiredError,
  TradeEffectiveAfterExpirationError,
  TradeNotFoundBySignatureError,
  TradeNotFoundError,
  DuplicateNFTOrderError,
  InvalidEstateTrade,
  EstateContractNotFoundForChainId
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
      e instanceof InvalidTradeSignatureError ||
      e instanceof InvalidTradeSignerError ||
      e instanceof InvalidECDSASignatureError ||
      e instanceof InvalidEstateTrade ||
      e instanceof EstateContractNotFoundForChainId
    ) {
      return {
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: e.message
        }
      }
    }

    if (e instanceof DuplicatedBidError || e instanceof DuplicateNFTOrderError) {
      return {
        status: StatusCode.CONFLICT,
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
        message: isErrorWithMessage(e) ? e.message : 'Trade could not be created'
      }
    }
  }
}

export async function getTradeHandler(
  context: Pick<HandlerContextWithPath<'trades', '/v1/trades/:id'>, 'components' | 'params'>
): Promise<HTTPResponse<Trade | null>> {
  try {
    const {
      components: { trades },
      params: { id }
    } = context

    const data = await trades.getTrade(id)

    return {
      status: StatusCode.OK,
      body: {
        ok: true,
        data
      }
    }
  } catch (e) {
    if (e instanceof TradeNotFoundError) {
      return {
        status: StatusCode.NOT_FOUND,
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
        message: isErrorWithMessage(e) ? e.message : 'Could not fetch the trade'
      }
    }
  }
}

export async function getTradeAcceptedEventHandler(
  context: Pick<HandlerContextWithPath<'trades', '/v1/trades/:hashedSignature/accepted'>, 'components' | 'params' | 'url'>
): Promise<HTTPResponse<Event | null>> {
  try {
    const {
      components: { trades },
      params: { hashedSignature },
      url
    } = context

    const tiemstamp = getNumberParameter('timestamp', url.searchParams) || Date.now()
    const caller = getParameter('caller', url.searchParams) || ''

    const data = await trades.getTradeAcceptedEvent(hashedSignature, tiemstamp, caller)

    return {
      status: StatusCode.OK,
      body: {
        ok: true,
        data
      }
    }
  } catch (e) {
    if (e instanceof TradeNotFoundBySignatureError) {
      return {
        status: StatusCode.NOT_FOUND,
        body: {
          ok: false,
          message: e.message
        }
      }
    }

    if (e instanceof EventNotGeneratedError) {
      return {
        status: StatusCode.ERROR,
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
        message: isErrorWithMessage(e) ? e.message : 'Could not generate trade event'
      }
    }
  }
}

export async function recreateTradesMaterializedViewHandler(
  context: Pick<HandlerContextWithPath<'trades', '/v1/trades/materialized-view/recreate'>, 'components'>
) {
  try {
    const {
      components: { trades }
    } = context

    await trades.recreateMaterializedView()

    return {
      status: StatusCode.OK,
      body: {
        ok: true,
        message: 'Materialized view recreated successfully'
      }
    }
  } catch (e) {
    return {
      status: StatusCode.INTERNAL_SERVER_ERROR,
      body: {
        ok: false,
        message: isErrorWithMessage(e) ? e.message : 'Could not recreate materialized view'
      }
    }
  }
}
