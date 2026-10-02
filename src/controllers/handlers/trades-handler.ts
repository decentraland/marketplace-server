import { Trade, TradeCreation, Event, ListingStatus } from '@dcl/schemas'
import { isAddress } from '../../logic/address'
import { isErrorWithMessage } from '../../logic/errors'
import { PaginatedResponse, getNonNegativeIntegerParameter, getNumberParameter, getPaginationParams, getParameter } from '../../logic/http'
import { InvalidParameterError, MissingParameterError } from '../../logic/http/errors'
import { DBTrade, TradeListFilters, TradeWithStatus } from '../../ports/trades'
import {
  DuplicatedBidError,
  InvalidCollectionItemCreatorError,
  InvalidECDSASignatureError,
  EventNotGeneratedError,
  InvalidTradePriceAssetError,
  InvalidTradeSignatureError,
  InvalidTradeSignerError,
  InvalidTradeStructureError,
  TradeAlreadyExpiredError,
  TradeEffectiveAfterExpirationError,
  TradeNotFoundBySignatureError,
  TradeNotFoundError,
  DuplicateNFTOrderError,
  DuplicateItemOrderError,
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

const MAX_MARKETPLACE_ADDRESS_FILTERS = 100
const TRADE_STATUSES: ListingStatus[] = [ListingStatus.OPEN, ListingStatus.SOLD, ListingStatus.CANCELLED]

function isListingStatus(value: string): value is ListingStatus {
  return TRADE_STATUSES.some(status => status === value)
}

/**
 * Parses the GET /v2/trades query: the required `signer`, repeatable `marketplace_address` and `status`, and
 * the `limit`/`offset`/`page` pagination of getPaginationParams.
 * @throws MissingParameterError if the signer is not given.
 * @throws InvalidParameterError if an address, a status or a pagination value is malformed.
 */
export function getTradeListParams(params: URLSearchParams): TradeListFilters {
  const signer = params.get('signer')
  if (signer === null) throw new MissingParameterError('signer')
  if (!isAddress(signer)) throw new InvalidParameterError('signer', signer)

  const marketplaceAddresses = params.getAll('marketplace_address')
  if (marketplaceAddresses.length > MAX_MARKETPLACE_ADDRESS_FILTERS) {
    throw new InvalidParameterError('marketplace_address', `more than ${MAX_MARKETPLACE_ADDRESS_FILTERS} values`)
  }
  for (const marketplaceAddress of marketplaceAddresses) {
    if (!isAddress(marketplaceAddress)) throw new InvalidParameterError('marketplace_address', marketplaceAddress)
  }

  const statuses: ListingStatus[] = []
  for (const status of params.getAll('status')) {
    if (!isListingStatus(status)) throw new InvalidParameterError('status', status)
    if (!statuses.includes(status)) statuses.push(status)
  }

  // getPaginationParams silently falls back on malformed input, so the format is checked first.
  if (getNonNegativeIntegerParameter('limit', params) === 0) throw new InvalidParameterError('limit', '0')
  getNonNegativeIntegerParameter('offset', params)
  getNonNegativeIntegerParameter('page', params)
  const { limit, offset } = getPaginationParams(params)

  return {
    signer: signer.toLowerCase(),
    ...(marketplaceAddresses.length > 0 && {
      marketplaceAddresses: marketplaceAddresses.map(marketplaceAddress => marketplaceAddress.toLowerCase())
    }),
    ...(statuses.length > 0 && { statuses }),
    limit,
    offset
  }
}

export async function getTradesV2Handler(
  context: Pick<HandlerContextWithPath<'trades' | 'logs', '/v2/trades'>, 'components' | 'url'>
): Promise<HTTPResponse<PaginatedResponse<TradeWithStatus>>> {
  const {
    components: { trades, logs },
    url
  } = context
  const logger = logs.getLogger('Trades handler')

  try {
    const filters = getTradeListParams(url.searchParams)
    const { data, count } = await trades.listTrades(filters)

    return {
      status: StatusCode.OK,
      body: {
        ok: true,
        data: {
          results: data,
          total: count,
          page: Math.floor(filters.offset / filters.limit),
          pages: Math.ceil(count / filters.limit),
          limit: filters.limit
        }
      }
    }
  } catch (e) {
    if (e instanceof InvalidParameterError || e instanceof MissingParameterError) {
      return {
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: e.message
        }
      }
    }

    logger.error('Could not list the trades', { error: isErrorWithMessage(e) ? e.message : String(e) })
    return {
      status: StatusCode.ERROR,
      body: {
        ok: false,
        message: 'Could not list the trades'
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
      e instanceof InvalidTradePriceAssetError ||
      e instanceof InvalidCollectionItemCreatorError ||
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

    if (e instanceof DuplicatedBidError || e instanceof DuplicateNFTOrderError || e instanceof DuplicateItemOrderError) {
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
