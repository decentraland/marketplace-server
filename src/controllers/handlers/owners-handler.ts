import { isErrorWithMessage } from '../../logic/errors'
import { Params } from '../../logic/http/params'
import { OwnersSortBy } from '../../ports/owners/types'
import { HandlerContextWithPath, StatusCode } from '../../types'

export async function getOwnersHandler(context: Pick<HandlerContextWithPath<'owners', '/v1/owners'>, 'components' | 'url'>) {
  try {
    const {
      components: { owners }
    } = context

    const params = new Params(context.url.searchParams)

    const contractAddress = params.getString('contractAddress')
    const itemId = params.getString('itemId')
    const sortBy = params.getValue<OwnersSortBy>('sortBy', OwnersSortBy) || OwnersSortBy.ISSUED_ID
    const orderDirection = params.getString('orderDirection') || 'desc'
    const first = params.getNumber('first')
    const skip = params.getNumber('skip')

    if (!contractAddress || !itemId) {
      return {
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: 'contractAddress and itemId are necessary params.'
        }
      }
    }

    const { data, total } = await owners.fetchAndCount({
      contractAddress,
      itemId,
      orderDirection,
      sortBy,
      first,
      skip
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
        message: isErrorWithMessage(e) ? e.message : 'Could not fetch owners'
      }
    }
  }
}
