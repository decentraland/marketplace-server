import type { IFetchComponent } from '@well-known-components/http-server'
import type {
  IConfigComponent,
  ILoggerComponent,
  IHttpServerComponent,
  IBaseComponent,
  IMetricsComponent
} from '@well-known-components/interfaces'
import type * as authorizationMiddleware from 'decentraland-crypto-middleware'
import { metricDeclarations } from './metrics'
import { IAnalyticsDayDataComponent } from './ports/analyticsDayData/types'
import { IBalanceComponent } from './ports/balance/types'
import { IBidsComponent } from './ports/bids'
import { ICatalogComponent } from './ports/catalog/types'
import { IPgComponent } from './ports/db/types'
import { IENSComponent } from './ports/ens/types'
import { IEventPublisherComponent } from './ports/events/types'
import { IAccessComponent } from './ports/favorites/access'
import { IListsComponents } from './ports/favorites/lists'
import { IPicksComponent } from './ports/favorites/picks'
import { ISnapshotComponent } from './ports/favorites/snapshot'
import { IItemsComponent } from './ports/items'
import { IJobComponent } from './ports/job'
import { INFTsComponent } from './ports/nfts/types'
import { IOrdersComponent } from './ports/orders/types'
import { IPricesComponent } from './ports/prices'
import { IItemsDayDataComponent } from './ports/rankings/types'
import { IRentalsComponent } from './ports/rentals/types'
import { ISalesComponent } from './ports/sales'
import { ISchemaValidatorComponent } from './ports/schema-validator'
import { IStatsComponent } from './ports/stats/types'
import { ITradesComponent } from './ports/trades/types'
import { ITransakComponent } from './ports/transak/types'
import { ITrendingsComponent } from './ports/trendings/types'
import { IVolumeComponent } from './ports/volume/types'
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
  favoritesDatabase: IPgComponent
  dappsDatabase: IPgComponent
  dappsWriteDatabase: IPgComponent
  catalog: ICatalogComponent
  balances: IBalanceComponent
  wertSigner: IWertSignerComponent
  transak: ITransakComponent
  ens: IENSComponent
  updateBuilderServerItemsViewJob: IJobComponent
  schemaValidator: ISchemaValidatorComponent
  lists: IListsComponents
  snapshot: ISnapshotComponent
  picks: IPicksComponent
  access: IAccessComponent
  items: IItemsComponent
  trades: ITradesComponent
  bids: IBidsComponent
  eventPublisher: IEventPublisherComponent
  nfts: INFTsComponent
  orders: IOrdersComponent
  rentals: IRentalsComponent
  sales: ISalesComponent
  trendings: ITrendingsComponent
  prices: IPricesComponent
  stats: IStatsComponent
  rankings: IItemsDayDataComponent
  volumes: IVolumeComponent
  analyticsData: IAnalyticsDayDataComponent
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
  UPDATED = 204,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  LOCKED = 423,
  CONFLICT = 409,
  ERROR = 500,
  UNPROCESSABLE_CONTENT = 422,
  INTERNAL_SERVER_ERROR = 500
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  body:
    | {
        ok: false
        message: string
        data?: object
      }
    | {
        ok: true
        data?: PaginatedResponse<T>
      }
    | {
        ok: true
        data?: T
      }
}

export enum SquidNetwork {
  ETHEREUM = 'ETHEREUM',
  POLYGON = 'POLYGON'
}
