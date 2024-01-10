import type { IFetchComponent } from '@well-known-components/http-server'
import type {
  IConfigComponent,
  ILoggerComponent,
  IHttpServerComponent,
  IBaseComponent,
  IMetricsComponent
} from '@well-known-components/interfaces'
import { IPgComponent } from '@well-known-components/pg-component'
import type * as authorizationMiddleware from 'decentraland-crypto-middleware'
import { metricDeclarations } from './metrics'
import { IBalanceComponent } from './ports/balance/types'
import { ICatalogComponent } from './ports/catalog/types'
import { IFavoritesComponent } from './ports/favorites/types'
import { IWertSignerComponent } from './ports/wert-signer/types'

export type GlobalContext = {
  components: BaseComponents
}

// components used in every environment
export type BaseComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  server: IHttpServerComponent<GlobalContext>
  fetch: IFetchComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  database: IPgComponent
  catalog: ICatalogComponent
  balances: IBalanceComponent
  wertSigner: IWertSignerComponent
  favoritesComponent: IFavoritesComponent
}

// components used in runtime
export type AppComponents = BaseComponents & {
  statusChecks: IBaseComponent
}

// components used in tests
export type TestComponents = BaseComponents & {
  // A fetch component that only hits the test server
  localFetch: IFetchComponent
}

// this type simplifies the typings of http handlers
export type HandlerContextWithPath<ComponentNames extends keyof AppComponents, Path extends string> = IHttpServerComponent.PathAwareContext<
  IHttpServerComponent.DefaultContext<{
    components: Pick<AppComponents, ComponentNames>
  }> &
    authorizationMiddleware.DecentralandSignatureContext,
  Path
>

export type Context<Path extends string> = IHttpServerComponent.PathAwareContext<GlobalContext, Path>

export enum StatusCode {
  OK = 200,
  CREATED = 201,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  NOT_FOUND = 404,
  LOCKED = 423,
  CONFLICT = 409,
  ERROR = 500
}

export type AuthenticatedContext<Path extends string = any> = Context<Path> & authorizationMiddleware.DecentralandSignatureContext

export type PaginatedResponse<T> = {
  results: T[]
  total: number
  page: number
  pages: number
  limit: number
}

export type HTTPErrorResponseBody<T> = {
  ok: false
  message: string
  data?: T
}

export type HTTPSuccessResponseBody<T> = {
  ok: true
  data: T
}

export type HTTPResponseBody<T> = HTTPErrorResponseBody<T> | HTTPSuccessResponseBody<T>

export type HTTPResponse<T> = {
  status: StatusCode
  body: HTTPResponseBody<T>
}
