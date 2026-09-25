import { Params } from '../../logic/http/params'
import { TopOwnersTimeoutError } from '../../ports/owners/errors'
import { TopOwnersSortBy } from '../../ports/owners/types'
import { HandlerContextWithPath, StatusCode } from '../../types'

/**
 * GET /v1/owners/top — every account holding a creator's items, ranked by what they hold or paid.
 *
 * @param context - The owners component and the request URL.
 * @returns The page of owners and the total, 400 on invalid parameters, 503 when the creator is too large
 *   to aggregate in time.
 */
export async function getTopOwnersHandler(context: Pick<HandlerContextWithPath<'owners', '/v1/owners/top'>, 'components' | 'url'>) {
  const params = new Params(context.url.searchParams)
  const creator = params.getAddress('creator')
  if (!creator) {
    return { status: StatusCode.BAD_REQUEST, body: { ok: false, message: 'A valid creator address is required' } }
  }

  const rawSortBy = params.getString('sortBy')
  const sortBy = params.getValue<TopOwnersSortBy>('sortBy', TopOwnersSortBy)
  if (rawSortBy !== undefined && !sortBy) {
    return {
      status: StatusCode.BAD_REQUEST,
      body: { ok: false, message: `sortBy must be one of ${Object.values(TopOwnersSortBy).join(', ')}` }
    }
  }
  const rawDirection = params.getString('orderDirection')
  if (rawDirection !== undefined && rawDirection !== 'asc' && rawDirection !== 'desc') {
    return { status: StatusCode.BAD_REQUEST, body: { ok: false, message: 'orderDirection must be asc or desc' } }
  }
  const orderDirection = rawDirection

  try {
    const { data, total } = await context.components.owners.fetchTopOwners({
      creator,
      sortBy,
      orderDirection,
      first: params.getNumber('first'),
      skip: params.getNumber('skip')
    })
    return { status: StatusCode.OK, body: { data, total } }
  } catch (e) {
    if (e instanceof TopOwnersTimeoutError) {
      return { status: StatusCode.SERVICE_UNAVAILABLE, body: { ok: false, message: e.message } }
    }
    throw e
  }
}
