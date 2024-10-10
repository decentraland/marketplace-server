import { SaleFilters } from '@dcl/schemas'
import { isErrorWithMessage } from '../../logic/errors'
import { Params } from '../../logic/http/params'
import { HandlerContextWithPath, StatusCode } from '../../types'
import { getSalesParams } from './utils'

export async function getSalesHandler(context: Pick<HandlerContextWithPath<'sales', '/v1/sales'>, 'components' | 'url' | 'verification'>) {
  try {
    const {
      components: { sales }
    } = context

    const params = new Params(context.url.searchParams)

    const filters: SaleFilters = getSalesParams(params)

    const { data, total } = await sales.getSales(filters)

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
        message: isErrorWithMessage(e) ? e.message : 'Could not fetch sales'
      }
    }
  }
}
