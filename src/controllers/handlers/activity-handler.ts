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

  logger.info(
    `[/v1/activity] handler reached. verification=${JSON.stringify({
      auth: verification?.auth,
      authMetadata: verification?.authMetadata
    })} search=${url.search}`
  )

  const address = verification?.auth.toLowerCase()
  if (!address) {
    logger.warn('[/v1/activity] no verified address; returning 401')
    return {
      status: StatusCode.UNAUTHORIZED,
      body: { ok: false, message: 'Unauthorized' }
    }
  }

  try {
    const limit = getNumberParameter('limit', url.searchParams) ?? undefined
    const offset = getNumberParameter('offset', url.searchParams) ?? undefined
    logger.info(`[/v1/activity] fetching activity for ${address} limit=${limit ?? 'default'} offset=${offset ?? 0}`)
    const { data, total } = await activity.getUserActivity(address, { limit, offset })
    logger.info(`[/v1/activity] success for ${address}: ${data.length} events (total=${total})`)
    return {
      status: StatusCode.OK,
      body: { data, total }
    }
  } catch (e) {
    logger.error(`[/v1/activity] failed for ${address}: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`)
    return {
      status: StatusCode.ERROR,
      body: { ok: false, message: 'Could not fetch activity' }
    }
  }
}
