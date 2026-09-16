import { Params } from '../../logic/http/params'
import { HandlerContextWithPath, StatusCode } from '../../types'

export async function getSalesSummaryHandler(context: Pick<HandlerContextWithPath<'sales', '/v1/sales/summary'>, 'components' | 'url'>) {
  const params = new Params(context.url.searchParams)
  const seller = params.getAddress('seller')
  if (!seller) {
    return { status: StatusCode.BAD_REQUEST, body: { ok: false, message: 'A valid seller address is required' } }
  }

  const bounds: { from?: number; to?: number } = {}
  for (const key of ['from', 'to'] as const) {
    const value = params.getString(key)
    if (value !== undefined) {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
        return { status: StatusCode.BAD_REQUEST, body: { ok: false, message: `${key} must be an epoch timestamp in milliseconds` } }
      }
      bounds[key] = Number(value)
    }
  }
  if (bounds.from !== undefined && bounds.to !== undefined && bounds.from > bounds.to) {
    return { status: StatusCode.BAD_REQUEST, body: { ok: false, message: 'from must be less than or equal to to' } }
  }

  const data = await context.components.sales.getSummary({ seller, ...bounds })
  return { status: StatusCode.OK, body: { data } }
}
