import { OrderFilters } from '@dcl/schemas'
import { isErrorWithMessage } from '../../logic/errors'
import { Params } from '../../logic/http/params'
import { HandlerContextWithPath, StatusCode } from '../../types'
import { getOrdersParams } from './utils'

export async function getOrdersHandler(
  context: Pick<HandlerContextWithPath<'orders', '/v1/orders'>, 'components' | 'url' | 'verification'>
) {
  try {
    const {
      components: { orders }
    } = context

    const params = new Params(context.url.searchParams)

    const filters: OrderFilters = getOrdersParams(params)

    const { data, total } = await orders.getOrders(filters)

    return {
      status: StatusCode.OK,
      body: {
        data,
        total
      }
    }
  } catch (e) {
    return {
      status: StatusCode.BAD_REQUEST,
      body: {
        ok: false,
        message: isErrorWithMessage(e) ? e.message : 'Could not fetch orders'
      }
    }
  }
}
