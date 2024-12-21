import { ItemFilters } from '@dcl/schemas'
import { fromDBPickStatsToPickStats } from '../../adapters/picks'
import { isErrorWithMessage } from '../../logic/errors'
import { enhanceItemsWithPicksStats } from '../../logic/favorites/utils'
import { Params } from '../../logic/http/params'
import { HandlerContextWithPath, StatusCode } from '../../types'
import { getItemsParams } from './utils'

export async function getItemsHandler(
  context: Pick<HandlerContextWithPath<'items' | 'picks', '/v1/items'>, 'components' | 'url' | 'verification'>
) {
  try {
    const {
      components: { items, picks }
    } = context

    const params = new Params(context.url.searchParams)
    const caller: string | undefined = context.verification?.auth.toLowerCase()

    const filters: ItemFilters = getItemsParams(params)

    const { data, total } = await items.getItems({
      ...filters
    })

    let result = data
    const pickStats = await picks.getPicksStats(
      data.map(({ id }) => id),
      {
        userAddress: caller
      }
    )

    result = enhanceItemsWithPicksStats(result, pickStats.map(fromDBPickStatsToPickStats))

    return {
      status: StatusCode.OK,
      body: {
        data: result,
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
