import { DBTrade } from '../../ports/trades'
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
