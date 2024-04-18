// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment
import path from 'path'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent } from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createPgComponent, IPgComponent } from '@well-known-components/pg-component'
import { createRunner, createLocalFetchCompoment } from '@well-known-components/test-helpers'
import { createFetchComponent } from '../src/adapters/fetch'
import { metricDeclarations } from '../src/metrics'
import { createBalanceComponent } from '../src/ports/balance/component'
import { createCatalogComponent } from '../src/ports/catalog/component'
import { createENS } from '../src/ports/ens/component'
import { createFavoritesComponent } from '../src/ports/favorites/components'
import { createJobComponent } from '../src/ports/job'
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
  const databaseUrl = (await config.getString('PG_COMPONENT_PSQL_CONNECTION_STRING')) || ''
  const schema = await config.requireString('PG_COMPONENT_PSQL_SCHEMA')
  const fetch = await createFetchComponent()
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const logs = await createLogComponent({ metrics })
  const server = await createServerComponent<GlobalContext>({ config, logs }, { cors })

  const database = await createPgComponent(
    { logs, config, metrics },
    {
      migration: {
        databaseUrl,
        schema,
        dir: path.resolve(__dirname, '../src/migrations'),
        migrationsTable: 'pgmigrations',
        ignorePattern: '.*\\.map',
        direction: 'up'
      }
    }
  )

  const MARKETPLACE_FAVORITES_SERVER_URL = await config.requireString('MARKETPLACE_FAVORITES_SERVER_URL')

  const favoritesComponent = createFavoritesComponent({ fetch }, MARKETPLACE_FAVORITES_SERVER_URL)
  const SEGMENT_WRITE_KEY = await config.requireString('SEGMENT_WRITE_KEY')
  const catalog = await createCatalogComponent({ database, favoritesComponent }, SEGMENT_WRITE_KEY)
  const COVALENT_API_KEY = await config.getString('COVALENT_API_KEY')
  const balances = createBalanceComponent({ apiKey: COVALENT_API_KEY ?? '' })
  const WERT_PRIVATE_KEY = await config.requireString('WERT_PRIVATE_KEY')
  const WERT_PUBLICATION_FEES_PRIVATE_KEY = await config.requireString('WERT_PUBLICATION_FEES_PRIVATE_KEY')
  const wertSigner = createWertSigner({ privateKey: WERT_PRIVATE_KEY, publicationFeesPrivateKey: WERT_PUBLICATION_FEES_PRIVATE_KEY })
  const ens = createENS()
  const updateBuilderServerItemsViewJob = createJobComponent({ logs }, () => catalog.updateBuilderServerItemsView(), 5 * 60 * 1000, {
    startupDelay: 0
  })

  // Mock the start function to avoid connecting to a local database
  jest.spyOn(database, 'start').mockResolvedValue(undefined)

  return {
    config,
    logs,
    server,
    localFetch: await createLocalFetchCompoment(config),
    fetch,
    metrics,
    database,
    catalog,
    favoritesComponent,
    balances,
    wertSigner,
    ens,
    updateBuilderServerItemsViewJob
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
