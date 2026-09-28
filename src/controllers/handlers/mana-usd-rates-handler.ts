import { Params } from '../../logic/http/params'
import { HandlerContextWithPath, StatusCode } from '../../types'

const MAX_SPAN_MS = 15 * 366 * 86_400_000

/**
 * GET /v1/rates/mana-usd — the closing MANA/USD rate of each UTC day between two instants.
 *
 * @param context - The history component and the request URL.
 * @returns One rate per stored day, oldest first; 400 on missing, malformed or reversed bounds.
 */
export async function getManaUsdRatesHandler(
  context: Pick<HandlerContextWithPath<'manaUsdHistory', '/v1/rates/mana-usd'>, 'components' | 'url'>
) {
  const params = new Params(context.url.searchParams)
  const bounds: { from?: number; to?: number } = {}
  for (const key of ['from', 'to'] as const) {
    const value = params.getString(key)
    if (value === undefined || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      return { status: StatusCode.BAD_REQUEST, body: { ok: false, message: `${key} must be an epoch timestamp in milliseconds` } }
    }
    bounds[key] = Number(value)
  }
  const { from, to } = bounds as { from: number; to: number }
  if (from > to) {
    return { status: StatusCode.BAD_REQUEST, body: { ok: false, message: 'from must be less than or equal to to' } }
  }
  if (to - from > MAX_SPAN_MS) {
    return { status: StatusCode.BAD_REQUEST, body: { ok: false, message: 'The range can span at most 15 years' } }
  }
  const data = await context.components.manaUsdHistory.getDailyRates(from, to)
  return { status: StatusCode.OK, body: { data } }
}
