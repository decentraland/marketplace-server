import { HttpError } from '../../logic/http/response'
import { Balance } from '../../ports/balance/types'
import { HTTPResponse, HandlerContextWithPath, StatusCode } from '../../types'

export async function createBalanceHandler(
  context: Pick<HandlerContextWithPath<'balances', '/v1/:chainId/address/:wallet/balance'>, 'params' | 'components'>
): Promise<HTTPResponse<Balance[]>> {
  const {
    params,
    components: { balances }
  } = context

  try {
    const { wallet, chainId } = params

    const response = await balances.getAddressChainBalance(chainId, wallet)

    return {
      status: StatusCode.OK,
      body: {
        ok: true,
        data: response
      }
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return {
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: error.message
        }
      }
    }

    throw error
  }
}
