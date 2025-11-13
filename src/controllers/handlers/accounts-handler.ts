import { isErrorWithMessage } from '../../logic/errors'
import { Params } from '../../logic/http/params'
import { AccountFilters } from '../../ports/accounts/types'
import { HandlerContextWithPath, StatusCode } from '../../types'
import { getAccountsParams } from './utils'

export async function getAccountsHandler(
  context: Pick<HandlerContextWithPath<'accounts', '/v1/accounts'>, 'components' | 'url' | 'verification'>
) {
  try {
    const {
      components: { accounts }
    } = context

    const params = new Params(context.url.searchParams)

    const filters: AccountFilters = getAccountsParams(params)

    const { data, total } = await accounts.getAccounts(filters)

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
        message: isErrorWithMessage(e) ? e.message : 'Could not fetch accounts'
      }
    }
  }
}

