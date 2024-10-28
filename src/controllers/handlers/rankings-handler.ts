import { EmoteCategory, Rarity, WearableCategory } from '@dcl/schemas'
import { isErrorWithMessage } from '../../logic/errors'
import { Params } from '../../logic/http/params'
import { HttpError } from '../../logic/http/response'
import { AnalyticsTimeframe } from '../../ports/analyticsDayData/types'
import { getTimestampFromTimeframe } from '../../ports/analyticsDayData/utils'
import { RankingEntity, RankingsSortBy } from '../../ports/rankings/types'
import { HandlerContextWithPath, StatusCode } from '../../types'

export async function getRankingsHandler(
  context: Pick<HandlerContextWithPath<'rankings', '/rankings/:entity/:timeframe'>, 'components' | 'url' | 'params'>
) {
  try {
    const {
      components: { rankings }
    } = context

    const { entity, timeframe } = context.params
    const params = new Params(context.url.searchParams)
    const first = params.getNumber('first')
    const sortBy = params.getValue<RankingsSortBy>('sortBy', RankingsSortBy)
    const category = params.getValue<WearableCategory | EmoteCategory>('category', { ...WearableCategory, ...EmoteCategory })
    const rarity = params.getValue<Rarity>('rarity', Rarity)

    const supportedEntities = Object.values(RankingEntity)

    if (!supportedEntities.includes(entity as RankingEntity)) {
      throw new HttpError(`Entity not supported: ${entity}. Supported entities are: ${supportedEntities.join(', ')}`, 400)
    }

    return {
      status: StatusCode.OK,
      body: {
        data: await rankings.fetch(entity as RankingEntity, {
          from: getTimestampFromTimeframe(timeframe as AnalyticsTimeframe),
          first,
          sortBy,
          category,
          rarity
        })
      }
    }
  } catch (e) {
    return {
      status: StatusCode.BAD_REQUEST,
      body: {
        ok: false,
        message: isErrorWithMessage(e) ? e.message : 'Could not fetch prices'
      }
    }
  }
}
