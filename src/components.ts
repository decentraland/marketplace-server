import path from 'path'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent, createStatusCheckComponent } from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent, instrumentHttpServerWithMetrics } from '@well-known-components/metrics'
import { createPgComponent } from '@well-known-components/pg-component'
import { createFetchComponent } from './adapters/fetch'
import { metricDeclarations } from './metrics'
import { createBalanceComponent } from './ports/balance/component'
import { createCatalogComponent } from './ports/catalog/component'
import { createENS } from './ports/ens/component'
import { createFavoritesComponent } from './ports/favorites/components'
import { createWertSigner } from './ports/wert-signer/component'
import { AppComponents, GlobalContext } from './types'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  let databaseUrl: string | undefined = await config.getString('PG_COMPONENT_PSQL_CONNECTION_STRING')
  const cors = {
    origin: await config.requireString('CORS_ORIGIN'),
    methods: await config.requireString('CORS_METHODS')
  }
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const logs = await createLogComponent({ metrics })
  const server = await createServerComponent<GlobalContext>({ config, logs }, { cors })
  const statusChecks = await createStatusCheckComponent({ server, config })
  const fetch = await createFetchComponent()

  if (!databaseUrl) {
    const dbUser = await config.requireString('PG_COMPONENT_PSQL_USER')
    const dbDatabaseName = await config.requireString('PG_COMPONENT_PSQL_DATABASE')
    const dbPort = await config.requireString('PG_COMPONENT_PSQL_PORT')
    const dbHost = await config.requireString('PG_COMPONENT_PSQL_HOST')
    const dbPassword = await config.requireString('PG_COMPONENT_PSQL_PASSWORD')

    databaseUrl = `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbDatabaseName}`
  }

  const schema = await config.requireString('PG_COMPONENT_PSQL_SCHEMA')

  const database = await createPgComponent(
    { config, logs, metrics },
    {
      migration: {
        databaseUrl,
        schema,
        dir: path.resolve(__dirname, 'migrations'),
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

  await instrumentHttpServerWithMetrics({ metrics, server, config })

  return {
    config,
    logs,
    server,
    statusChecks,
    fetch,
    metrics,
    database,
    catalog,
    favoritesComponent,
    balances,
    wertSigner,
    ens
  }
}
