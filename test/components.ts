// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent } from '@well-known-components/http-server'
import { ILoggerComponent, ITracerComponent } from '@well-known-components/interfaces'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createRunner, createLocalFetchCompoment } from '@well-known-components/test-helpers'
import { createTracerComponent } from '@well-known-components/tracer-component'
import { createFetchComponent } from '../src/adapters/fetch'
import { metricDeclarations } from '../src/metrics'
import { createBalanceComponent } from '../src/ports/balance/component'
import { createBidsComponents } from '../src/ports/bids'
import { createCatalogComponent } from '../src/ports/catalog/component'
import { createPgComponent } from '../src/ports/db/component'
import { IPgComponent } from '../src/ports/db/types'
import { createENS } from '../src/ports/ens/component'
import { IEventPublisherComponent } from '../src/ports/events'
import { IAccessComponent, createAccessComponent } from '../src/ports/favorites/access'
import { IItemsComponent, createItemsComponent } from '../src/ports/favorites/items'
import { IListsComponents, createListsComponent } from '../src/ports/favorites/lists'
import { IPicksComponent, createPicksComponent } from '../src/ports/favorites/picks'
import { ISnapshotComponent, createSnapshotComponent } from '../src/ports/favorites/snapshot'
import { createJobComponent } from '../src/ports/job'
import { createSchemaValidatorComponent } from '../src/ports/schema-validator'
import { createTradesComponent } from '../src/ports/trades'
import { createWertSigner } from '../src/ports/wert-signer/component'
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

  const dappsDatabase = await createPgComponent(
    { config, logs, metrics },
    {
      dbPrefix: 'DAPPS'
    }
  )

  const SEGMENT_WRITE_KEY = await config.requireString('SEGMENT_WRITE_KEY')
  const COVALENT_API_KEY = await config.getString('COVALENT_API_KEY')
  const WERT_PRIVATE_KEY = await config.requireString('WERT_PRIVATE_KEY')
  const WERT_PUBLICATION_FEES_PRIVATE_KEY = await config.requireString('WERT_PUBLICATION_FEES_PRIVATE_KEY')
  const wertSigner = createWertSigner({ privateKey: WERT_PRIVATE_KEY, publicationFeesPrivateKey: WERT_PUBLICATION_FEES_PRIVATE_KEY })
  const ens = createENS()

  // favorites stuff
  const snapshot = await createSnapshotComponent({ fetch, config })
  const items = createItemsComponent({ logs, dappsDatabase })
  const lists = createListsComponent({
    favoritesDatabase,
    items,
    snapshot,
    logs
  })
  const access = createAccessComponent({ favoritesDatabase, logs, lists })
  const picks = createPicksComponent({ favoritesDatabase, items, snapshot, logs, lists })
  const catalog = await createCatalogComponent({ dappsDatabase, picks }, SEGMENT_WRITE_KEY)
  const schemaValidator = await createSchemaValidatorComponent()
  const balances = createBalanceComponent({ apiKey: COVALENT_API_KEY ?? '' })
  const trades = createTradesComponent({ dappsDatabase, eventPublisher })
  const bids = createBidsComponents({ dappsDatabase })
  // Mock the start function to avoid connecting to a local database
  jest.spyOn(dappsDatabase, 'start').mockResolvedValue(undefined)
  jest.spyOn(catalog, 'updateBuilderServerItemsView').mockResolvedValue(undefined)
  const updateBuilderServerItemsViewJob = createJobComponent({ logs }, () => undefined, 5 * 60 * 1000, {
    startupDelay: 30
  })

  return {
    config,
    logs,
    server,
    localFetch: await createLocalFetchCompoment(config),
    fetch,
    metrics,
    dappsDatabase,
    favoritesDatabase,
    catalog,
    balances,
    wertSigner,
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
    eventPublisher
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
    validateItemExists
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
