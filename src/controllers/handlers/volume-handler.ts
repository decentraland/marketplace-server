import { isErrorWithMessage } from '../../logic/errors'
import { AnalyticsTimeframe } from '../../ports/analyticsDayData/types'
import { HandlerContextWithPath, StatusCode } from '../../types'

export async function getVolumeHandler(
  context: Pick<HandlerContextWithPath<'volumes', '/volume/:timeframe'>, 'components' | 'url' | 'params'>
) {
  try {
    const {
      components: { volumes }
    } = context

    const { timeframe } = context.params

    return {
      status: StatusCode.OK,
      body: {
        data: await volumes.fetch(timeframe as AnalyticsTimeframe)
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
