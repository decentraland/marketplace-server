// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent } from '@well-known-components/http-server'
import { ILoggerComponent, ITracerComponent } from '@well-known-components/interfaces'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createRunner, createLocalFetchCompoment } from '@well-known-components/test-helpers'
import { createSubgraphComponent } from '@well-known-components/thegraph-component'
import { createTracerComponent } from '@well-known-components/tracer-component'
import { createFetchComponent } from '../src/adapters/fetch'
import { metricDeclarations } from '../src/metrics'
import { createAnalyticsDayDataComponent } from '../src/ports/analyticsDayData/component'
import { createBidsComponents } from '../src/ports/bids'
import { createCatalogComponent } from '../src/ports/catalog/component'
import { createPgComponent } from '../src/ports/db/component'
import { IPgComponent } from '../src/ports/db/types'
import { createENS } from '../src/ports/ens/component'
import { IEventPublisherComponent } from '../src/ports/events'
import { IAccessComponent, createAccessComponent } from '../src/ports/favorites/access'
import { IListsComponents, createListsComponent } from '../src/ports/favorites/lists'
import { IPicksComponent, createPicksComponent } from '../src/ports/favorites/picks'
import { ISnapshotComponent, createSnapshotComponent } from '../src/ports/favorites/snapshot'
import { IItemsComponent, createItemsComponent } from '../src/ports/items'
import { createJobComponent } from '../src/ports/job'
import { createNFTsComponent } from '../src/ports/nfts/component'
import { createOrdersComponent } from '../src/ports/orders/component'
import { createOwnersComponent } from '../src/ports/owners/component'
import { createPricesComponents } from '../src/ports/prices'
import { createRankingsComponent } from '../src/ports/rankings/component'
import { createRentalsComponent } from '../src/ports/rentals/components'
import { createSalesComponents } from '../src/ports/sales'
import { createSchemaValidatorComponent } from '../src/ports/schema-validator'
import { createStatsComponent } from '../src/ports/stats/component'
import { createTradesComponent } from '../src/ports/trades'
import { createTransakComponent } from '../src/ports/transak/component'
import { createTrendingsComponent } from '../src/ports/trendings/component'
import { createVolumeComponent } from '../src/ports/volume/component'
import { createWertApi } from '../src/ports/wert/api/component'
import { createWertSigner } from '../src/ports/wert/signer/component'
import { main } from '../src/service'
import { GlobalContext, TestComponents } from '../src/types'

/**
 * Behaves like Jest "describe" function, used to describe a test for a
 * use case, it creates a whole new program and components to run an
 * isolated test.
 *
 * State is persistent within the steps of the test.
 */
export const test = createRunner<TestComponents>({
  main,
  initComponents
})

async function initComponents(): Promise<TestComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env.spec', '.env'] })
  const cors = {
    origin: await config.requireString('CORS_ORIGIN'),
    methods: await config.requireString('CORS_METHODS')
  }
  const tracer = createTracerComponent()
  const fetch = await createFetchComponent({ tracer })
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const logs = await createLogComponent({ metrics })
  const server = await createServerComponent<GlobalContext>({ config, logs }, { cors })
  const eventPublisher: IEventPublisherComponent = { publishMessage: () => Promise.resolve('event') }

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

  const SEGMENT_WRITE_KEY = await config.requireString('SEGMENT_WRITE_KEY')
  const WERT_PRIVATE_KEY = await config.requireString('WERT_PRIVATE_KEY')
  const WERT_PUBLICATION_FEES_PRIVATE_KEY = await config.requireString('WERT_PUBLICATION_FEES_PRIVATE_KEY')
  const wertSigner = createWertSigner({ privateKey: WERT_PRIVATE_KEY, publicationFeesPrivateKey: WERT_PUBLICATION_FEES_PRIVATE_KEY })
  const wertApi = await createWertApi({ config, fetch })
  const ens = createENS()

  // favorites stuff
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
  const catalog = await createCatalogComponent({ dappsDatabase: dappsReadDatabase, dappsWriteDatabase, picks }, SEGMENT_WRITE_KEY)
  const schemaValidator = await createSchemaValidatorComponent()
  const trades = createTradesComponent({ dappsDatabase: dappsWriteDatabase, eventPublisher, logs })
  const bids = createBidsComponents({ dappsDatabase: dappsReadDatabase })

  const rentalsSubgraph = await createSubgraphComponent(
    { logs, config, fetch, metrics },
    await config.requireString('RENTALS_SUBGRAPH_URL')
  )
  const SIGNATURES_SERVER_URL = await config.requireString('SIGNATURES_SERVER_URL')
  const rentals = createRentalsComponent({ fetch }, SIGNATURES_SERVER_URL, rentalsSubgraph)

  const nfts = createNFTsComponent({ dappsDatabase: dappsReadDatabase, config, rentals })
  const orders = createOrdersComponent({ dappsDatabase: dappsReadDatabase })
  const owners = createOwnersComponent({ dappsDatabase: dappsReadDatabase })
  const sales = createSalesComponents({ dappsDatabase: dappsReadDatabase })
  const prices = createPricesComponents({ dappsDatabase: dappsReadDatabase })
  // Mock the start function to avoid connecting to a local database
  jest.spyOn(catalog, 'updateBuilderServerItemsView').mockResolvedValue(undefined)
  const updateBuilderServerItemsViewJob = createJobComponent({ logs }, () => undefined, 5 * 60 * 1000, {
    startupDelay: 30
  })

  const transak = createTransakComponent({ fetch }, { apiURL: '', apiKey: '', apiSecret: '' })
  const stats = await createStatsComponent({ dappsDatabase: dappsReadDatabase })
  const trendings = await createTrendingsComponent({ dappsDatabase: dappsReadDatabase, items, picks })
  const rankings = await createRankingsComponent({ dappsDatabase: dappsReadDatabase })
  const analyticsData = await createAnalyticsDayDataComponent({ dappsDatabase: dappsReadDatabase })
  const volumes = await createVolumeComponent({ analyticsData })

  return {
    config,
    logs,
    server,
    localFetch: await createLocalFetchCompoment(config),
    fetch,
    metrics,
    dappsDatabase: dappsReadDatabase,
    dappsWriteDatabase,
    favoritesDatabase,
    catalog,
    wertSigner,
    wertApi,
    ens,
    updateBuilderServerItemsViewJob,
    access,
    lists,
    picks,
    snapshot,
    items,
    schemaValidator,
    bids,
    trades,
    eventPublisher,
    nfts,
    orders,
    owners,
    rentals,
    sales,
    prices,
    transak,
    stats,
    trendings,
    rankings,
    analyticsData,
    volumes
  }
}

export function createTestLogsComponent({ getLogger = jest.fn() } = { getLogger: jest.fn() }): ILoggerComponent {
  return {
    getLogger
  }
}

export function createTestPicksComponent(
  { getPicksStats = jest.fn(), getPicksByItemId = jest.fn(), pickAndUnpickInBulk = jest.fn() } = {
    getPicksStats: jest.fn(),
    getPicksByItemId: jest.fn(),
    pickAndUnpickInBulk: jest.fn()
  }
): IPicksComponent {
  return {
    getPicksStats,
    getPicksByItemId,
    pickAndUnpickInBulk
  }
}

export function createTestSnapshotComponent({ getScore = jest.fn() } = { getScore: jest.fn() }): ISnapshotComponent {
  return {
    getScore
  }
}

export function createTestListsComponent(
  {
    getPicksByListId = jest.fn(),
    addPickToList = jest.fn(),
    deletePickInList = jest.fn(),
    getLists = jest.fn(),
    addList = jest.fn(),
    deleteList = jest.fn(),
    getList = jest.fn(),
    updateList = jest.fn(),
    checkNonEditableLists = jest.fn()
  } = {
    getPicksByListId: jest.fn(),
    addPickToList: jest.fn(),
    deletePickInList: jest.fn(),
    getLists: jest.fn(),
    addList: jest.fn(),
    deleteList: jest.fn(),
    updateList: jest.fn(),
    getList: jest.fn()
  }
): IListsComponents {
  return {
    getPicksByListId,
    addPickToList,
    deletePickInList,
    getLists,
    addList,
    deleteList,
    getList,
    updateList,
    checkNonEditableLists
  }
}

export function createTestAccessComponent(
  { deleteAccess = jest.fn(), createAccess = jest.fn() } = { deleteAccess: jest.fn(), createAccess: jest.fn() }
): IAccessComponent {
  return {
    createAccess,
    deleteAccess
  }
}

export function createTestItemsComponent({ validateItemExists = jest.fn() }): IItemsComponent {
  return {
    validateItemExists,
    getItems: jest.fn()
  }
}

export function createTestPgComponent(
  { query = jest.fn(), start = jest.fn(), streamQuery = jest.fn(), getPool = jest.fn(), stop = jest.fn(), withTransaction = jest.fn() } = {
    query: jest.fn(),
    start: jest.fn(),
    streamQuery: jest.fn(),
    getPool: jest.fn(),
    stop: jest.fn(),
    withTransaction: jest.fn()
  }
): IPgComponent {
  return {
    start,
    streamQuery,
    query,
    getPool,
    stop,
    withTransaction
  }
}

export function createTestTracerComponent(
  {
    span = jest.fn(),
    isInsideOfTraceSpan = jest.fn(),
    getSpanId = jest.fn(),
    getTrace = jest.fn(),
    getTraceString = jest.fn(),
    getTraceChild = jest.fn(),
    getTraceChildString = jest.fn(),
    getTraceState = jest.fn(),
    getTraceStateString = jest.fn(),
    getContextData = jest.fn(),
    setContextData = jest.fn(),
    setTraceStateProperty = jest.fn(),
    deleteTraceStateProperty = jest.fn()
  } = {
    span: jest.fn(),
    isInsideOfTraceSpan: jest.fn(),
    getSpanId: jest.fn(),
    getTrace: jest.fn(),
    getTraceString: jest.fn(),
    getTraceChild: jest.fn(),
    getTraceChildString: jest.fn(),
    getTraceState: jest.fn(),
    getTraceStateString: jest.fn(),
    getContextData: jest.fn(),
    setContextData: jest.fn(),
    setTraceStateProperty: jest.fn(),
    deleteTraceStateProperty: jest.fn()
  }
): ITracerComponent {
  return {
    span,
    isInsideOfTraceSpan,
    getSpanId,
    getTrace,
    getTraceString,
    getTraceChild,
    getTraceChildString,
    getTraceState,
    getTraceStateString,
    getContextData,
    setContextData,
    setTraceStateProperty,
    deleteTraceStateProperty
  }
}
