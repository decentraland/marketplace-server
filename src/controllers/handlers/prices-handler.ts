import { isErrorWithMessage } from '../../logic/errors'
import { Params } from '../../logic/http/params'
import { PriceFilters } from '../../ports/prices'
import { HandlerContextWithPath, StatusCode } from '../../types'
import { getPricesParams } from './utils'

export async function getPricesHandler(
  context: Pick<HandlerContextWithPath<'prices', '/v1/prices'>, 'components' | 'url' | 'verification'>
) {
  try {
    const {
      components: { prices }
    } = context

    const params = new Params(context.url.searchParams)

    const filters: PriceFilters = getPricesParams(params)

    const result = await prices.getPrices(filters)

    return {
      status: StatusCode.OK,
      body: result
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
