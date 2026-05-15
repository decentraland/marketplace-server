import { getNumberParameter } from '../../logic/http'
import { ActivityEvent } from '../../ports/activity/types'
import { HandlerContextWithPath, StatusCode } from '../../types'

export async function getActivityHandler(
  context: Pick<HandlerContextWithPath<'activity' | 'logs', '/v1/activity'>, 'components' | 'url' | 'verification'>
): Promise<{
  status: StatusCode
  body: { data: ActivityEvent[]; total: number } | { ok: false; message: string }
}> {
  const {
    components: { activity, logs },
    url,
    verification
  } = context
  const logger = logs.getLogger('Activity handler')

  const address = verification?.auth.toLowerCase()
  if (!address) {
    return {
      status: StatusCode.UNAUTHORIZED,
      body: { ok: false, message: 'Unauthorized' }
    }
  }

  try {
    const limit = getNumberParameter('limit', url.searchParams) ?? undefined
    const offset = getNumberParameter('offset', url.searchParams) ?? undefined
    const { data, total } = await activity.getUserActivity(address, { limit, offset })
    return {
      status: StatusCode.OK,
      body: { data, total }
    }
  } catch (e) {
    logger.error(
      `Failed to fetch activity for ${address} (limit=${url.searchParams.get('limit') ?? 'default'}, offset=${
        url.searchParams.get('offset') ?? '0'
      }): ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`
    )
    return {
      status: StatusCode.ERROR,
      body: { ok: false, message: 'Could not fetch activity' }
    }
  }
}
