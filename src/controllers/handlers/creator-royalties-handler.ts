import { Params } from '../../logic/http/params'
import { HandlerContextWithPath, StatusCode } from '../../types'

const DEFAULT_PAGE = 20
const MAX_PAGE = 100
// The latest instant a JavaScript Date can hold.
const MAX_DATE_MS = 8.64e15

function wholeNumber(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined
  const n = /^\d+$/.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(n) ? n : null
}

/**
 * GET /v1/sales/royalties — the resales of a creator's items, newest first, with the royalty each paid.
 *
 * @param context - The sales component and the request URL.
 * @returns A page of resales, the number in the window and their royalty total; 400 on invalid parameters.
 */
export async function getCreatorRoyaltiesHandler(
  context: Pick<HandlerContextWithPath<'sales', '/v1/sales/royalties'>, 'components' | 'url'>
) {
  const params = new Params(context.url.searchParams)
  const creator = params.getAddress('creator')
  if (!creator) {
    return { status: StatusCode.BAD_REQUEST, body: { ok: false, message: 'A valid creator address is required' } }
  }

  const bounds: { from?: number; to?: number } = {}
  for (const key of ['from', 'to'] as const) {
    const value = wholeNumber(params.getString(key))
    if (value === null || (value !== undefined && value > MAX_DATE_MS)) {
      return { status: StatusCode.BAD_REQUEST, body: { ok: false, message: `${key} must be an epoch timestamp in milliseconds` } }
    }
    if (value !== undefined) bounds[key] = value
  }
  if (bounds.from !== undefined && bounds.to !== undefined && bounds.from > bounds.to) {
    return { status: StatusCode.BAD_REQUEST, body: { ok: false, message: 'from must be less than or equal to to' } }
  }

  const first = wholeNumber(params.getString('first'))
  const skip = wholeNumber(params.getString('skip'))
  if (first === null || skip === null || first === 0) {
    return { status: StatusCode.BAD_REQUEST, body: { ok: false, message: 'first and skip must be whole numbers, first at least 1' } }
  }

  const page = await context.components.sales.getRoyalties({
    creator,
    ...bounds,
    first: Math.min(first ?? DEFAULT_PAGE, MAX_PAGE),
    skip: skip ?? 0
  })
  return { status: StatusCode.OK, body: page }
}
