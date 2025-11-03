import { isErrorWithMessage } from '../../logic/errors'
import { WidgetOptions, OrderResponse } from '../../ports/transak/types'
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

export async function createTransakWidgetHandler(
  context: Pick<HandlerContextWithPath<'transak', '/v1/transak/widget'>, 'components' | 'request'>
): Promise<HTTPResponse<string>> {
  const {
    components: { transak },
    request
  } = context

  const widgetOptions: Partial<WidgetOptions> = await request.json()

  try {
    const widgetUrl = await transak.getWidget(widgetOptions)

    return {
      status: StatusCode.OK,
      body: {
        ok: true,
        data: widgetUrl
      }
    }
  } catch (error) {
    return {
      status: StatusCode.INTERNAL_SERVER_ERROR,
      body: {
        ok: false,
        message: isErrorWithMessage(error) ? error.message : 'Unknown error'
      }
    }
  }
}

export async function refreshTransakAccessTokenHandler(
  context: Pick<HandlerContextWithPath<'transak', '/v1/transak/refresh-access-token'>, 'components'>
): Promise<HTTPResponse<string>> {
  const {
    components: { transak }
  } = context

  try {
    await transak.getOrRefreshAccessToken()
  } catch (error) {
    return {
      status: StatusCode.INTERNAL_SERVER_ERROR,
      body: {
        ok: false,
        message: isErrorWithMessage(error) ? error.message : 'Unknown error'
      }
    }
  }

  return {
    status: StatusCode.OK,
    body: {
      ok: true
    }
  }
}
