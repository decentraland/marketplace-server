import { isErrorWithMessage } from '../../logic/errors'
import { Params } from '../../logic/http/params'
import { CollectionFilters } from '../../ports/collections/types'
import { HandlerContextWithPath, StatusCode } from '../../types'
import { getCollectionsParams } from './utils'

export async function getCollectionsHandler(
  context: Pick<HandlerContextWithPath<'collections', '/v1/collections'>, 'components' | 'url' | 'verification'>
) {
  try {
    const {
      components: { collections }
    } = context

    const params = new Params(context.url.searchParams)

    const filters: CollectionFilters = getCollectionsParams(params)

    const { data, total } = await collections.getCollections(filters)

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
        message: isErrorWithMessage(e) ? e.message : 'Could not fetch collections'
      }
    }
  }
}
