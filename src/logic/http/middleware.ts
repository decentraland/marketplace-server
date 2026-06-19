import { IHttpServerComponent } from '@dcl/core-commons'
import { bearerTokenMiddleware as baseBearerTokenMiddleware } from '@dcl/platform-server-commons'

/**
 * `@dcl/platform-server-commons` types `bearerTokenMiddleware` against node-fetch's `Request`, while
 * `@dcl/http-server` v2 passes the native fetch `Request`. The middleware only reads the
 * `authorization` header (present on both request types) at runtime, so we re-type its handler to the
 * native handler signature to keep the router type-safe without changing runtime behaviour.
 */
export function bearerTokenMiddleware(token: string): IHttpServerComponent.IRequestHandler<object> {
  return baseBearerTokenMiddleware(token) as unknown as IHttpServerComponent.IRequestHandler<object>
}
