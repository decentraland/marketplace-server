import { IHttpServerComponent } from '@well-known-components/interfaces'
import { HandlerContextWithPath, StatusCode } from '../../types'

export async function validateApiToken(
  context: Pick<HandlerContextWithPath<'config', string>, 'components' | 'request'>,
  apiTokenHeaderName = 'x-api-token'
): Promise<boolean> {
  const { config } = context.components
  const expectedApiToken = await config.getString('TRADES_API_TOKEN')

  if (!expectedApiToken) {
    return false
  }

  const providedApiToken = context.request.headers.get(apiTokenHeaderName)
  return providedApiToken === expectedApiToken
}

export function createTradesViewAuthMiddleware(apiTokenHeaderName = 'x-api-token') {
  return async function tradesViewAuthMiddleware(
    context: Pick<HandlerContextWithPath<'config', string>, 'components' | 'request'>,
    next: () => Promise<IHttpServerComponent.IResponse>
  ) {
    const isValid = await validateApiToken(context, apiTokenHeaderName)

    if (!isValid) {
      console.log('[tradesViewAuthMiddleware] Invalid token, returning unauthorized')
      return {
        status: StatusCode.UNAUTHORIZED,
        body: {
          ok: false,
          message: 'Unauthorized'
        }
      }
    }

    return next()
  }
}
