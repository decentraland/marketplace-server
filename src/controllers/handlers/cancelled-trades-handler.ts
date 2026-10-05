import { Params } from '../../logic/http/params'
import { TradeCancellationReason } from '../../ports/cancelled-trades/types'
import { HandlerContextWithPath, StatusCode } from '../../types'

const DEFAULT_PAGE = 20
const MAX_PAGE = 100

function wholeNumber(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined
  const n = /^\d+$/.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(n) ? n : null
}

function isCancellationReason(value: string | undefined): value is TradeCancellationReason {
  return Object.values(TradeCancellationReason).some(reason => reason === value)
}

/**
 * GET /v1/cancelled-trades — the signed-in signer's trades cancelled for a reason, still pending re-creation.
 *
 * @param context - The cancelled trades component, the request URL and the signed fetch verification.
 * @returns A page of cancelled trades and their total; 401 when unsigned, 400 on invalid parameters.
 */
export async function getCancelledTradesHandler(
  context: Pick<HandlerContextWithPath<'cancelledTrades', '/v1/cancelled-trades'>, 'components' | 'url' | 'verification'>
) {
  const signer = context.verification?.auth.toLowerCase()
  if (!signer) {
    return { status: StatusCode.UNAUTHORIZED, body: { ok: false, message: 'Unauthorized' } }
  }

  const params = new Params(context.url.searchParams)
  const reason = params.getString('reason')
  if (!isCancellationReason(reason)) {
    return {
      status: StatusCode.BAD_REQUEST,
      body: { ok: false, message: `reason must be one of: ${Object.values(TradeCancellationReason).join(', ')}` }
    }
  }

  const first = wholeNumber(params.getString('first'))
  const skip = wholeNumber(params.getString('skip'))
  if (first === null || skip === null || first === 0) {
    return { status: StatusCode.BAD_REQUEST, body: { ok: false, message: 'first and skip must be whole numbers, first at least 1' } }
  }

  const page = await context.components.cancelledTrades.getCancelledTrades({
    signer,
    reason,
    first: Math.min(first ?? DEFAULT_PAGE, MAX_PAGE),
    skip: skip ?? 0
  })
  return { status: StatusCode.OK, body: page }
}
