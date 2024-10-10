import { SaleFilters } from '@dcl/schemas'
import { isErrorWithMessage } from '../../logic/errors'
import { Params } from '../../logic/http/params'
import { HandlerContextWithPath, StatusCode } from '../../types'
import { getPricesParams } from './utils'

export async function getSalesHandler(
  context: Pick<HandlerContextWithPath<'prices', '/v1/prices'>, 'components' | 'url' | 'verification'>
) {
  try {
    const {
      components: { prices }
    } = context

    const params = new Params(context.url.searchParams)

    const filters: SaleFilters = getPricesParams(params)

    const { data, total } = await prices.getPrices(filters)

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
