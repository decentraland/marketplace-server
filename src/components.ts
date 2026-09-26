import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { Client as PgClient } from 'pg'
import { instrumentHttpServerWithRequestLogger } from '@dcl/http-requests-logger-component'
import { createServerComponent, createStatusCheckComponent, instrumentHttpServerWithPromClientRegistry } from '@dcl/http-server'
import { createHttpTracerComponent } from '@dcl/http-tracer-component'
import { createInMemoryCacheComponent } from '@dcl/memory-cache-component'
import { createMetricsComponent } from '@dcl/metrics'
import { createRedisComponent } from '@dcl/redis-component'
import { createSchemaValidatorComponent } from '@dcl/schema-validator-component'
import { createSubgraphComponent } from '@dcl/thegraph-component'
import { createTracerComponent } from '@dcl/tracer-component'
import { createFetchComponent } from './adapters/fetch'
import { withRetries } from './logic/retry'
import { NEIGHBORS_REBUILD_INTERVAL_MS, NEIGHBORS_REBUILD_STARTUP_DELAY_MS } from './logic/suggestions/constants'
import { runNeighborsJob } from './logic/suggestions/run-neighbors-job'
import { metricDeclarations } from './metrics'
import { createAccountsComponent } from './ports/accounts/component'
import { createActivityComponent } from './ports/activity'
import { createAnalyticsDayDataComponent } from './ports/analyticsDayData/component'
import { createBidsComponents } from './ports/bids'
import { createCatalogComponent } from './ports/catalog/component'
import { createCollectionsComponent } from './ports/collections/component'
import { createContractsComponent } from './ports/contracts/component'
import { createCouponsComponent } from './ports/coupons'
import { COUPON_STATE_REFRESH_INTERVAL_MS } from './ports/coupons/types'
import { createCreatorProfilesComponent } from './ports/creator-profiles/component'
import {
  CREATOR_PROFILES_REFRESH_INTERVAL_MS,
  CREATOR_PROFILES_REFRESH_STARTUP_DELAY_MS,
  CREATOR_PROFILES_RUN_RETRY_DELAYS_MS
} from './ports/creator-profiles/types'
import { createPgComponent, resolveConnectionString } from './ports/db/component'
import { createEventPublisher } from './ports/events/publisher'
import { createAccessComponent } from './ports/favorites/access'
import { createListsComponent } from './ports/favorites/lists'
import { createPicksComponent } from './ports/favorites/picks'
import { createSnapshotComponent } from './ports/favorites/snapshot'
import { createItemsComponent } from './ports/items'
import { createDisabledJobComponent, createJobComponent } from './ports/job'
import { createManaUsdRateComponent } from './ports/mana-rate/component'
import { createEthersOracleReader, createManaUsdHistoryComponent } from './ports/mana-usd-history/component'
import { createNFTsComponent } from './ports/nfts/component'
import { createOrdersComponent } from './ports/orders/component'
import { createOwnersComponent } from './ports/owners/component'
import { createPricesComponents } from './ports/prices'
import { createRankingsComponent } from './ports/rankings/component'
import { createRentalsComponent } from './ports/rentals/components'
import { createSalesComponents } from './ports/sales'
import { createSearchSuggestComponent } from './ports/search-suggest/component'
import { createShopCatalogComponent } from './ports/shop-catalog/component'
import { createShopNotifierComponent } from './ports/shop-notifier/component'
import { createStatsComponent } from './ports/stats/component'
import { createSuggestionsComponent } from './ports/suggestions'
import { createTradesComponent } from './ports/trades'
import { createTransakComponent } from './ports/transak/component'
import { createTrendingsComponent } from './ports/trendings/component'
import { createUserAssetsComponent } from './ports/user-assets/component'
import { createVolumeComponent } from './ports/volume/component'
import { createWertApi } from './ports/wert/api/component'
import { createWertSigner } from './ports/wert/signer/component'
import { AppComponents, GlobalContext } from './types'

const thirtySeconds = 30 * 1000
const fiveMinutes = 5 * 60 * 1000
const tenMinutes = 10 * 60 * 1000
// Small enough that one run holds its pooled connection for about a minute; a backfill from 2021 then
// takes roughly half a day of runs, and a caught-up table needs one day per run.
const MANA_USD_HISTORY_DAYS_PER_RUN = 30

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
    TRANSAK_API_GATEWAY_URL,
    TRANSAK_API_KEY,
    TRANSAK_API_SECRET,
    MARKETPLACE_BASE_URL,
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
    config.requireString('TRANSAK_API_GATEWAY_URL'),
    config.requireString('TRANSAK_API_KEY'),
    config.requireString('TRANSAK_API_SECRET'),
    config.requireString('MARKETPLACE_BASE_URL'),
    config.getString('REDIS_URL')
  ])

  const eventPublisher = await createEventPublisher({ config })
  const cors = {
    origin: CORS_ORIGIN.split(';').map(origin => new RegExp(origin)),
    methods: CORS_METHODS.split(',')
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

  // rentals
  const rentalsSubgraph = await createSubgraphComponent({ logs, config, fetch, metrics }, RENTALS_SUBGRAPH_URL)
  const rentals = createRentalsComponent({ fetch }, SIGNATURES_SERVER_URL, rentalsSubgraph)

  // favorites stuff
  const schemaValidator = await createSchemaValidatorComponent()

  const cache = REDIS_URL ? await createRedisComponent(REDIS_URL, { logs }) : await createInMemoryCacheComponent()
  const inMemoryCache = await createInMemoryCacheComponent() // Used for caching data that should not be stored in Redis

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
  const shopCatalog = createShopCatalogComponent({ dappsDatabase: dappsReadDatabase, logs })
  const creatorProfiles = await createCreatorProfilesComponent({
    config,
    logs,
    fetch,
    dappsDatabase: dappsReadDatabase,
    dappsWriteDatabase
  })
  const suggestions = await createSuggestionsComponent({ dappsDatabase: dappsReadDatabase, shopCatalog, lists, cache, logs, config })
  const manaUsdRate = await createManaUsdRateComponent({ config, logs })
  const shopNotifier = await createShopNotifierComponent({ config, logs, fetch })
  const searchSuggest = createSearchSuggestComponent({ dappsDatabase: dappsReadDatabase, items, creatorProfiles, manaUsdRate })
  const trades = await createTradesComponent({ dappsDatabase: dappsWriteDatabase, eventPublisher, logs, shopNotifier })
  // Trailing flush for the debounced trades materialized view refresh: any write that
  // arrived while the leading-edge debounce gate was closed only marks the state row
  // dirty, so this reflects it within one interval instead of waiting for an unrelated
  // trigger (see flushTradesMaterializedViewIfDirty).
  const flushTradesMaterializedViewLogger = logs.getLogger('flush-trades-mv-job')
  const flushTradesMaterializedViewJob = createJobComponent({ logs }, () => trades.flushMaterializedViewIfDirty(), thirtySeconds, {
    startupDelay: thirtySeconds,
    // A failed REFRESH re-marks the state row dirty (flushTradesMaterializedViewIfDirty) so it retries
    // next tick; log it here so the failure isn't swallowed silently.
    onError: error =>
      flushTradesMaterializedViewLogger.error(
        `Failed to flush the trades materialized view: ${error instanceof Error ? error.message : String(error)}`
      )
  })
  const coupons = createCouponsComponent({ dappsDatabase: dappsWriteDatabase, logs })

  // The closing MANA/USD rate of every day since the feed started, so the Shop can show a sale in what it
  // was worth that day. Unconfigured (no RPC or oracle), the table stays as it is and reads still answer.
  const historyRpcUrl = await config.getString('RPC_ENDPOINT_POLYGON')
  const historyOracle = await config.getString('MANA_USD_ORACLE_ADDRESS')
  const manaUsdHistory = createManaUsdHistoryComponent({
    dappsDatabase: dappsWriteDatabase,
    logs,
    reader: historyRpcUrl && historyOracle ? createEthersOracleReader(historyRpcUrl, historyOracle) : null
  })
  // A backfill from 2021 is about 1,900 days at ~20 oracle reads each, so it is spread over runs; once
  // caught up, each run stores the day that just closed. Kill switch: MANA_USD_HISTORY_JOB_ENABLED=false.
  const manaUsdHistoryLogger = logs.getLogger('mana-usd-history-job')
  const fillManaUsdHistoryJob =
    (await config.getString('MANA_USD_HISTORY_JOB_ENABLED')) === 'false'
      ? createDisabledJobComponent(manaUsdHistoryLogger, 'fill-mana-usd-history')
      : createJobComponent({ logs }, () => manaUsdHistory.fillMissingDays(MANA_USD_HISTORY_DAYS_PER_RUN), tenMinutes, {
          startupDelay: thirtySeconds,
          onError: error =>
            manaUsdHistoryLogger.error(`Failed to fill the MANA/USD history: ${error instanceof Error ? error.message : String(error)}`)
        })
  // Mirrors what the CouponManager knows about each live coupon (uses consumed, cancelled) so the catalogue
  // never advertises a sale the chain would refuse. The chain is the truth; this is a cache of it.
  const refreshCouponStateLogger = logs.getLogger('refresh-coupon-state-job')
  const refreshCouponStateJob = createJobComponent({ logs }, () => coupons.refreshState(), COUPON_STATE_REFRESH_INTERVAL_MS, {
    startupDelay: thirtySeconds,
    onError: error =>
      refreshCouponStateLogger.error(`Failed to refresh coupon state: ${error instanceof Error ? error.message : String(error)}`)
  })

  // Rebuilds the item-neighbours table behind /v3/catalog/suggested. It runs in this process but on its
  // own short-lived connections: the pooled clients cap every statement at 40 seconds and the acquisition
  // scan alone runs past 80. All three replicas fire on the same schedule; the advisory lock inside the
  // job is what stops them duplicating the work.
  //
  // A KILL SWITCH, not a provisioning step: SUGGESTIONS_NEIGHBORS_JOB_ENABLED=false stops the rebuild,
  // and anything else runs it. The Shop's feature flag hides the RAIL and has no bearing on this, so
  // without a switch of its own there would be no way to stop the rebuild short of killing the task --
  // which is why it exists. It defaults to ON because the cost is backwards otherwise: a default of off
  // makes the NORMAL case (the job should run) cost a definitions PR and a redeploy, to save that same
  // cost on the rare one. When off, nothing is scheduled and no connection is opened.
  const rebuildNeighborsLogger = logs.getLogger('rebuild-item-neighbors-job')
  const neighborsJobEnabled = (await config.getString('SUGGESTIONS_NEIGHBORS_JOB_ENABLED')) !== 'false'
  const rebuildItemNeighborsJob = !neighborsJobEnabled
    ? createDisabledJobComponent(rebuildNeighborsLogger, 'item neighbours rebuild')
    : await (async () => {
        const neighborsConnectionStrings = {
          read: await resolveConnectionString(config, 'DAPPS_READ'),
          write: await resolveConnectionString(config, 'DAPPS')
        }
        return createJobComponent(
          { logs },
          () =>
            runNeighborsJob({
              connect: async role => {
                const client = new PgClient({
                  connectionString: neighborsConnectionStrings[role],
                  application_name: `marketplace-server-neighbors-${role}`
                })
                await client.connect()
                return client
              },
              logger: rebuildNeighborsLogger,
              metrics: {
                observe: ({ durationMs, rows, peakRssBytes }) => {
                  metrics.observe('suggestions_neighbors_build_duration_seconds', {}, durationMs / 1000)
                  metrics.observe('suggestions_neighbors_rows', {}, rows)
                  metrics.observe('suggestions_neighbors_peak_rss_bytes', {}, peakRssBytes)
                }
              }
            }),
          NEIGHBORS_REBUILD_INTERVAL_MS,
          {
            startupDelay: NEIGHBORS_REBUILD_STARTUP_DELAY_MS,
            onError: error =>
              rebuildNeighborsLogger.error(`Failed to rebuild item neighbours: ${error instanceof Error ? error.message : String(error)}`)
          }
        )
      })()

  // Keeps the creator profiles table — what the search knows creators as — in step with Catalyst and the
  // squid. Cheap: sixteen profile lookups and one upsert every few hours, on a pooled connection.
  const refreshCreatorProfilesLogger = logs.getLogger('refresh-creator-profiles-job')
  const refreshCreatorProfilesJob = createJobComponent(
    { logs },
    () =>
      withRetries(() => creatorProfiles.refresh(), CREATOR_PROFILES_RUN_RETRY_DELAYS_MS, {
        onRetry: (error, delayMs) =>
          refreshCreatorProfilesLogger.warn(
            `Creator profiles refresh failed, trying again in ${delayMs} ms: ${error instanceof Error ? error.message : String(error)}`
          )
      }),
    CREATOR_PROFILES_REFRESH_INTERVAL_MS,
    {
      startupDelay: CREATOR_PROFILES_REFRESH_STARTUP_DELAY_MS,
      onError: error =>
        refreshCreatorProfilesLogger.error(`Failed to refresh creator profiles: ${error instanceof Error ? error.message : String(error)}`)
    }
  )

  const bids = await createBidsComponents({ dappsDatabase: dappsReadDatabase })
  const nfts = await createNFTsComponent({ dappsDatabase: dappsReadDatabase, config, rentals })
  const orders = await createOrdersComponent({ dappsDatabase: dappsReadDatabase })
  const contracts = createContractsComponent({ dappsDatabase: dappsReadDatabase, inMemoryCache })
  const collections = createCollectionsComponent({ dappsDatabase: dappsReadDatabase })
  const accounts = createAccountsComponent({ dappsDatabase: dappsReadDatabase })
  const owners = createOwnersComponent({ dappsDatabase: dappsReadDatabase, logs })
  const sales = await createSalesComponents({ dappsDatabase: dappsReadDatabase })
  const prices = await createPricesComponents({ dappsDatabase: dappsReadDatabase })
  const trendings = await createTrendingsComponent({ dappsDatabase: dappsReadDatabase, items, picks })
  const stats = await createStatsComponent({ dappsDatabase: dappsReadDatabase })
  const rankings = await createRankingsComponent({ dappsDatabase: dappsReadDatabase })
  const analyticsData = await createAnalyticsDayDataComponent({ dappsDatabase: dappsReadDatabase })
  const volumes = await createVolumeComponent({ analyticsData })
  const userAssets = await createUserAssetsComponent({ logs, dappsDatabase: dappsReadDatabase })
  const activity = createActivityComponent({ sales, bids, orders, trades, logs })

  const transak = await createTransakComponent(
    { fetch, logs, cache },
    {
      marketplaceURL: MARKETPLACE_BASE_URL,
      apiGatewayURL: TRANSAK_API_GATEWAY_URL,
      apiURL: TRANSAK_API_URL,
      apiKey: TRANSAK_API_KEY,
      apiSecret: TRANSAK_API_SECRET
    }
  )
  createHttpTracerComponent({ server, tracer })
  instrumentHttpServerWithRequestLogger({ server, logger: logs })
  // createMetricsComponent always initializes a prom-client registry; the IMetricsComponent type marks
  // `registry` optional, so assert it is present rather than guarding a case that cannot happen.
  await instrumentHttpServerWithPromClientRegistry({
    server,
    config,
    metrics,
    registry: metrics.registry as NonNullable<typeof metrics.registry>
  })

  return {
    bids,
    cache,
    inMemoryCache,
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
    shopCatalog,
    creatorProfiles,
    searchSuggest,
    suggestions,
    shopNotifier,
    manaUsdRate,
    wertSigner,
    wertApi,
    updateBuilderServerItemsViewJob,
    flushTradesMaterializedViewJob,
    coupons,
    refreshCouponStateJob,
    manaUsdHistory,
    fillManaUsdHistoryJob,
    rebuildItemNeighborsJob,
    refreshCreatorProfilesJob,
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
    contracts,
    collections,
    accounts,
    owners,
    rentals,
    sales,
    prices,
    trendings,
    transak,
    stats,
    rankings,
    analyticsData,
    volumes,
    userAssets,
    activity
  }
}
