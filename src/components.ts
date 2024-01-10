import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent, createStatusCheckComponent } from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent, instrumentHttpServerWithMetrics } from '@well-known-components/metrics'
import { createPgComponent } from '@well-known-components/pg-component'
import { createFetchComponent } from './adapters/fetch'
import { metricDeclarations } from './metrics'
import { createBalanceComponent } from './ports/balance/component'
import { createCatalogComponent } from './ports/catalog/component'
import { createFavoritesComponent } from './ports/favorites/components'
import { createWertSigner } from './ports/wert-signer/component'
import { AppComponents, GlobalContext } from './types'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const cors = {
    origin: await config.requireString('CORS_ORIGIN'),
    methods: await config.requireString('CORS_METHODS')
  }
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const logs = await createLogComponent({ metrics })
  const server = await createServerComponent<GlobalContext>({ config, logs }, { cors })
  const statusChecks = await createStatusCheckComponent({ server, config })
  const fetch = await createFetchComponent()
  const database = await createPgComponent({ config, logs, metrics })

  const MARKETPLACE_FAVORITES_SERVER_URL = await config.requireString('MARKETPLACE_FAVORITES_SERVER_URL')
  const favoritesComponent = createFavoritesComponent({ fetch }, MARKETPLACE_FAVORITES_SERVER_URL)

  const catalog = await createCatalogComponent({ database, favoritesComponent })
  const COVALENT_API_KEY = await config.getString('COVALENT_API_KEY')
  const balances = await createBalanceComponent({ apiKey: COVALENT_API_KEY ?? '' })
  const WERT_PRIVATE_KEY = await config.requireString('WERT_PRIVATE_KEY')
  const wertSigner = await createWertSigner({ privateKey: WERT_PRIVATE_KEY })

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
    wertSigner
  }
}
