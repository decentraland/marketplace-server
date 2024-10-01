import { ItemFilters } from '@dcl/schemas'
import { isErrorWithMessage } from '../../logic/errors'
import { Params } from '../../logic/http/params'
import { HandlerContextWithPath, StatusCode } from '../../types'
import { getItemsParams } from './utils'

export async function getItemsHandler(context: Pick<HandlerContextWithPath<'items', '/v1/items'>, 'components' | 'url' | 'verification'>) {
  try {
    const {
      components: { items }
    } = context

    const params = new Params(context.url.searchParams)

    const filters: ItemFilters = getItemsParams(params)

    const { data, total } = await items.getItems({
      ...filters
    })

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
        message: isErrorWithMessage(e) ? e.message : 'Could not fetch Items'
      }
    }
  }
}
