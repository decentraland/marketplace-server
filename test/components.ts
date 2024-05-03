// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent } from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { IPgComponent } from '@well-known-components/pg-component'
import { createRunner, createLocalFetchCompoment } from '@well-known-components/test-helpers'
import { createTracerComponent } from '@well-known-components/tracer-component'
import { createFetchComponent } from '../src/adapters/fetch'
import { metricDeclarations } from '../src/metrics'
import { createBalanceComponent } from '../src/ports/balance/component'
import { createCatalogComponent } from '../src/ports/catalog/component'
import { createPgComponent } from '../src/ports/db/component'
import { createENS } from '../src/ports/ens/component'
import { createAccessComponent } from '../src/ports/favorites/access'
import { createFavoritesComponent } from '../src/ports/favorites/components'
import { createItemsComponent } from '../src/ports/favorites/items'
import { createListsComponent } from '../src/ports/favorites/lists'
import { createPicksComponent } from '../src/ports/favorites/picks'
import { createSnapshotComponent } from '../src/ports/favorites/snapshot'
import { createJobComponent } from '../src/ports/job'
import { createSchemaValidatorComponent } from '../src/ports/schema-validator'
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
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const cors = {
    origin: await config.requireString('CORS_ORIGIN'),
    methods: await config.requireString('CORS_METHODS')
  }
  const tracer = createTracerComponent()
  const fetch = await createFetchComponent({ tracer })
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const logs = await createLogComponent({ metrics })
  const server = await createServerComponent<GlobalContext>({ config, logs }, { cors })

  const substreamsDatabase = await createPgComponent(
    { config, logs, metrics },
    {
      dbPrefix: 'SUBSTREAMS'
    }
  )

  const favoritesDatabase = await createPgComponent(
    { config, logs, metrics },
    {
      dbPrefix: 'FAVORITES'
    }
  )

  const MARKETPLACE_FAVORITES_SERVER_URL = await config.requireString('MARKETPLACE_FAVORITES_SERVER_URL')

  const favoritesComponent = createFavoritesComponent({ fetch }, MARKETPLACE_FAVORITES_SERVER_URL)
  const SEGMENT_WRITE_KEY = await config.requireString('SEGMENT_WRITE_KEY')
  const COVALENT_API_KEY = await config.getString('COVALENT_API_KEY')
  const WERT_PRIVATE_KEY = await config.requireString('WERT_PRIVATE_KEY')
  const WERT_PUBLICATION_FEES_PRIVATE_KEY = await config.requireString('WERT_PUBLICATION_FEES_PRIVATE_KEY')
  const wertSigner = createWertSigner({ privateKey: WERT_PRIVATE_KEY, publicationFeesPrivateKey: WERT_PUBLICATION_FEES_PRIVATE_KEY })
  const ens = createENS()

  // favorites stuff
  const snapshot = await createSnapshotComponent({ fetch, config })
  const items = createItemsComponent({ logs, substreamsDatabase })
  const lists = createListsComponent({
    favoritesDatabase,
    items,
    snapshot,
    logs
  })
  const access = createAccessComponent({ favoritesDatabase, logs, lists })
  const picks = createPicksComponent({ favoritesDatabase, items, snapshot, logs, lists })
  const catalog = await createCatalogComponent({ substreamsDatabase, picks }, SEGMENT_WRITE_KEY)
  const schemaValidator = await createSchemaValidatorComponent()
  const balances = createBalanceComponent({ apiKey: COVALENT_API_KEY ?? '' })
  // Mock the start function to avoid connecting to a local database
  jest.spyOn(substreamsDatabase, 'start').mockResolvedValue(undefined)
  jest.spyOn(favoritesDatabase, 'start').mockResolvedValue(undefined)
  jest.spyOn(catalog, 'updateBuilderServerItemsView').mockResolvedValue(undefined)
  const updateBuilderServerItemsViewJob = createJobComponent({ logs }, () => catalog.updateBuilderServerItemsView(), 5 * 60 * 1000, {
    startupDelay: 30
  })

  return {
    config,
    logs,
    server,
    localFetch: await createLocalFetchCompoment(config),
    fetch,
    metrics,
    substreamsDatabase,
    favoritesDatabase,
    catalog,
    favoritesComponent,
    balances,
    wertSigner,
    ens,
    updateBuilderServerItemsViewJob,
    access,
    lists,
    picks,
    snapshot,
    items,
    schemaValidator
  }
}

export function createTestDbComponent(
  { query = jest.fn(), start = jest.fn(), streamQuery = jest.fn(), getPool = jest.fn(), stop = jest.fn() } = {
    query: jest.fn(),
    start: jest.fn(),
    streamQuery: jest.fn(),
    getPool: jest.fn(),
    stop: jest.fn()
  }
): IPgComponent {
  return {
    start,
    streamQuery,
    query,
    getPool,
    stop
  }
}
