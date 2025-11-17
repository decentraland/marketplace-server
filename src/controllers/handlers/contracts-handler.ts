import { isErrorWithMessage } from '../../logic/errors'
import { Params } from '../../logic/http/params'
import { ContractFilters } from '../../ports/contracts/types'
import { HandlerContextWithPath, StatusCode } from '../../types'
import { getContractsParams } from './utils'

export async function getContractsHandler(
  context: Pick<HandlerContextWithPath<'contracts', '/v1/contracts'>, 'components' | 'url' | 'verification'>
) {
  try {
    const {
      components: { contracts }
    } = context

    const params = new Params(context.url.searchParams)

    const filters: ContractFilters = getContractsParams(params)

    const { data, total } = await contracts.getContracts(filters)

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
        message: isErrorWithMessage(e) ? e.message : 'Could not fetch contracts'
      }
    }
  }
}

