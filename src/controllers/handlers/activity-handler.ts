import { isErrorWithMessage } from '../../logic/errors'
import { ActivityEvent } from '../../ports/activity/types'
import { HandlerContextWithPath, HTTPResponse, StatusCode } from '../../types'

export async function getActivityHandler(
  context: Pick<HandlerContextWithPath<'activity', '/v1/activity'>, 'components' | 'verification'>
): Promise<HTTPResponse<{ data: ActivityEvent[]; total: number }>> {
  const address = context.verification?.auth.toLowerCase()
  if (!address) {
    return {
      status: StatusCode.UNAUTHORIZED,
      body: { ok: false, message: 'Unauthorized' }
    }
  }

  try {
    const { data, total } = await context.components.activity.getUserActivity(address)
    return {
      status: StatusCode.OK,
      body: {
        ok: true,
        data: { data, total }
      }
    }
  } catch (e) {
    return {
      status: StatusCode.ERROR,
      body: {
        ok: false,
        message: isErrorWithMessage(e) ? e.message : 'Could not fetch activity'
      }
    }
  }
}
