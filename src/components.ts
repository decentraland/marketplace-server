import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { instrumentHttpServerWithRequestLogger } from '@well-known-components/http-requests-logger-component'
import { createServerComponent, createStatusCheckComponent } from '@well-known-components/http-server'
import { createHttpTracerComponent } from '@well-known-components/http-tracer-component'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent, instrumentHttpServerWithMetrics } from '@well-known-components/metrics'
import { createSubgraphComponent } from '@well-known-components/thegraph-component'
import { createTracerComponent } from '@well-known-components/tracer-component'
import { createInMemoryCacheComponent } from '@dcl/memory-cache-component'
import { createRedisComponent } from '@dcl/redis-component'
import { createFetchComponent } from './adapters/fetch'
import { metricDeclarations } from './metrics'
import { createAnalyticsDayDataComponent } from './ports/analyticsDayData/component'
import { createBidsComponents } from './ports/bids'
import { createCatalogComponent } from './ports/catalog/component'
import { createPgComponent } from './ports/db/component'
import { createENS } from './ports/ens/component'
import { createEventPublisher } from './ports/events/publisher'
import { createAccessComponent } from './ports/favorites/access'
import { createListsComponent } from './ports/favorites/lists'
import { createPicksComponent } from './ports/favorites/picks'
import { createSnapshotComponent } from './ports/favorites/snapshot'
import { createItemsComponent } from './ports/items'
import { createJobComponent } from './ports/job'
import { createNFTsComponent } from './ports/nfts/component'
import { createOrdersComponent } from './ports/orders/component'
import { createOwnersComponent } from './ports/owners/component'
import { createPricesComponents } from './ports/prices'
import { createRankingsComponent } from './ports/rankings/component'
import { createRentalsComponent } from './ports/rentals/components'
import { createSalesComponents } from './ports/sales'
import { createSchemaValidatorComponent } from './ports/schema-validator'
import { createStatsComponent } from './ports/stats/component'
import { createTradesComponent } from './ports/trades'
import { createTransakComponent } from './ports/transak/component'
import { createTrendingsComponent } from './ports/trendings/component'
import { createVolumeComponent } from './ports/volume/component'
import { createWertApi } from './ports/wert/api/component'
import { createWertSigner } from './ports/wert/signer/component'
import { AppComponents, GlobalContext } from './types'

const thirtySeconds = 30 * 1000
const fiveMinutes = 5 * 60 * 1000

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const [
    CORS_ORIGIN,
    CORS_METHODS,
    SEGMENT_WRITE_KEY,
    WERT_PRIVATE_KEY,
    WERT_PUBLICATION_FEES_PRIVATE_KEY,
    RENTALS_SUBGRAPH_URL,
    SIGNATURES_SERVER_URL,
    TRANSAK_API_URL,
    TRANSAK_API_KEY,
    TRANSAK_API_SECRET,
    REDIS_URL
  ] = await Promise.all([
    config.requireString('CORS_ORIGIN'),
    config.requireString('CORS_METHODS'),
    config.requireString('SEGMENT_WRITE_KEY'),
    config.requireString('WERT_PRIVATE_KEY'),
    config.requireString('WERT_PUBLICATION_FEES_PRIVATE_KEY'),
    config.requireString('RENTALS_SUBGRAPH_URL'),
    config.requireString('SIGNATURES_SERVER_URL'),
    config.requireString('TRANSAK_API_URL'),
    config.requireString('TRANSAK_API_KEY'),
    config.requireString('TRANSAK_API_SECRET'),
    config.getString('REDIS_URL')
  ])

  const eventPublisher = await createEventPublisher({ config })
  const cors = {
    origin: CORS_ORIGIN.split(';').map(origin => new RegExp(origin)),
    methods: CORS_METHODS
  }
  const tracer = createTracerComponent()
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const logs = await createLogComponent({ metrics, tracer })
  const server = await createServerComponent<GlobalContext>({ config, logs }, { cors })
  const statusChecks = await createStatusCheckComponent({ server, config })
  const fetch = await createFetchComponent({ tracer })
  const updateBuilderServerItemsViewJob = createJobComponent({ logs }, () => catalog.updateBuilderServerItemsView(), fiveMinutes, {
    startupDelay: thirtySeconds
  })

  const favoritesDatabase = await createPgComponent(
    { config, logs, metrics },
    {
      dbPrefix: 'FAVORITES'
    }
  )

  const dappsWriteDatabase = await createPgComponent(
    { config, logs, metrics },
    {
      dbPrefix: 'DAPPS'
    }
  )

  const dappsReadDatabase = await createPgComponent(
    { config, logs, metrics },
    {
      dbPrefix: 'DAPPS_READ',
      migrations: false
    }
  )

  const wertSigner = createWertSigner({ privateKey: WERT_PRIVATE_KEY, publicationFeesPrivateKey: WERT_PUBLICATION_FEES_PRIVATE_KEY })
  const wertApi = await createWertApi({ config, fetch })
  const ens = createENS()

  // rentals
  const rentalsSubgraph = await createSubgraphComponent({ logs, config, fetch, metrics }, RENTALS_SUBGRAPH_URL)
  const rentals = createRentalsComponent({ fetch }, SIGNATURES_SERVER_URL, rentalsSubgraph)

  // favorites stuff
  const schemaValidator = await createSchemaValidatorComponent()

  const cache = REDIS_URL ? await createRedisComponent(REDIS_URL, { logs }) : await createInMemoryCacheComponent()

  const snapshot = await createSnapshotComponent({ fetch, config })
  const items = createItemsComponent({ logs, dappsDatabase: dappsReadDatabase })
  const lists = createListsComponent({
    favoritesDatabase,
    items,
    snapshot,
    logs
  })
  const access = createAccessComponent({ favoritesDatabase, logs, lists })
  const picks = createPicksComponent({ favoritesDatabase, items, snapshot, logs, lists })

  // catalog
  const catalog = await createCatalogComponent({ dappsDatabase: dappsReadDatabase, dappsWriteDatabase, picks }, SEGMENT_WRITE_KEY)
  const trades = await createTradesComponent({ dappsDatabase: dappsWriteDatabase, eventPublisher, logs })
  const bids = await createBidsComponents({ dappsDatabase: dappsReadDatabase })
  const nfts = await createNFTsComponent({ dappsDatabase: dappsReadDatabase, config, rentals })
  const orders = await createOrdersComponent({ dappsDatabase: dappsReadDatabase })
  const owners = createOwnersComponent({ dappsDatabase: dappsReadDatabase, logs })
  const sales = await createSalesComponents({ dappsDatabase: dappsReadDatabase })
  const prices = await createPricesComponents({ dappsDatabase: dappsReadDatabase })
  const trendings = await createTrendingsComponent({ dappsDatabase: dappsReadDatabase, items, picks })
  const stats = await createStatsComponent({ dappsDatabase: dappsReadDatabase })
  const rankings = await createRankingsComponent({ dappsDatabase: dappsReadDatabase })
  const analyticsData = await createAnalyticsDayDataComponent({ dappsDatabase: dappsReadDatabase })
  const volumes = await createVolumeComponent({ analyticsData })

  const transak = await createTransakComponent(
    { fetch, logs, cache },
    {
      apiURL: TRANSAK_API_URL,
      apiKey: TRANSAK_API_KEY,
      apiSecret: TRANSAK_API_SECRET
    }
  )
  createHttpTracerComponent({ server, tracer })
  instrumentHttpServerWithRequestLogger({ server, logger: logs })
  await instrumentHttpServerWithMetrics({ metrics, server, config })

  return {
    bids,
    cache,
    config,
    logs,
    server,
    statusChecks,
    fetch,
    metrics,
    favoritesDatabase,
    dappsDatabase: dappsReadDatabase,
    dappsWriteDatabase,
    catalog,
    wertSigner,
    wertApi,
    ens,
    updateBuilderServerItemsViewJob,
    schemaValidator,
    snapshot,
    items,
    lists,
    trades,
    access,
    picks,
    eventPublisher,
    nfts,
    orders,
    owners,
    rentals,
    sales,
    prices,
    trendings,
    transak,
    stats,
    rankings,
    analyticsData,
    volumes
  }
}
