import { OrderResponse } from '../../ports/transak/types'
import { HTTPResponse, HandlerContextWithPath, StatusCode } from '../../types'

export async function createTransakHandler(
  context: Pick<HandlerContextWithPath<'transak', '/v1/transak/orders/:id'>, 'url' | 'components' | 'params' | 'request' | 'verification'>
): Promise<HTTPResponse<OrderResponse>> {
  const {
    verification,
    components: { transak }
  } = context

  const id = context.params.id
  const userAddress: string | undefined = verification?.auth.toLowerCase()
  const order = await transak.getOrder(id)

  if (!userAddress || (!!userAddress && userAddress !== order.data.walletAddress.toLocaleLowerCase())) {
    return {
      status: StatusCode.UNAUTHORIZED,
      body: {
        ok: false,
        message: 'Unauthorized'
      }
    }
  }

  return {
    status: StatusCode.OK,
    body: {
      ok: true,
      data: order
    }
  }
}
