import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent, createStatusCheckComponent } from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent, instrumentHttpServerWithMetrics } from '@well-known-components/metrics'
import { createTracerComponent } from '@well-known-components/tracer-component'
import { createFetchComponent } from './adapters/fetch'
import { metricDeclarations } from './metrics'
import { createBalanceComponent } from './ports/balance/component'
import { createBidsComponents } from './ports/bids'
import { createCatalogComponent } from './ports/catalog/component'
import { createPgComponent } from './ports/db/component'
import { createENS } from './ports/ens/component'
import { createEventPublisher } from './ports/events/publisher'
import { createAccessComponent } from './ports/favorites/access'
import { createItemsComponent } from './ports/favorites/items'
import { createListsComponent } from './ports/favorites/lists'
import { createPicksComponent } from './ports/favorites/picks'
import { createSnapshotComponent } from './ports/favorites/snapshot'
import { createJobComponent } from './ports/job'
import { createSchemaValidatorComponent } from './ports/schema-validator'
import { createTradesComponent } from './ports/trades'
import { createWertSigner } from './ports/wert-signer/component'
import { AppComponents, GlobalContext } from './types'

const thirtySeconds = 30 * 1000
const fiveMinutes = 5 * 60 * 1000

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const eventPublisher = await createEventPublisher({ config })
  const cors = {
    origin: (await config.requireString('CORS_ORIGIN')).split(';').map(origin => new RegExp(origin)),
    methods: await config.requireString('CORS_METHODS')
  }
  const tracer = createTracerComponent()
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const logs = await createLogComponent({ metrics })
  const server = await createServerComponent<GlobalContext>({ config, logs }, { cors })
  const statusChecks = await createStatusCheckComponent({ server, config })
  const fetch = await createFetchComponent({ tracer })
  const updateBuilderServerItemsViewJob = createJobComponent({ logs }, () => catalog.updateBuilderServerItemsView(), fiveMinutes, {
    startupDelay: thirtySeconds
  })

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

  const balances = createBalanceComponent({ apiKey: COVALENT_API_KEY ?? '' })
  const wertSigner = createWertSigner({ privateKey: WERT_PRIVATE_KEY, publicationFeesPrivateKey: WERT_PUBLICATION_FEES_PRIVATE_KEY })
  const ens = createENS()

  // favorites stuff
  const schemaValidator = await createSchemaValidatorComponent()

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

  // catalog
  const catalog = await createCatalogComponent({ substreamsDatabase, picks }, SEGMENT_WRITE_KEY)
  const trades = await createTradesComponent({ dappsDatabase, eventPublisher, logs })
  const bids = await createBidsComponents({ dappsDatabase })

  await instrumentHttpServerWithMetrics({ metrics, server, config })

  return {
    bids,
    config,
    logs,
    server,
    statusChecks,
    fetch,
    metrics,
    substreamsDatabase,
    favoritesDatabase,
    dappsDatabase,
    catalog,
    balances,
    wertSigner,
    ens,
    updateBuilderServerItemsViewJob,
    schemaValidator,
    snapshot,
    items,
    lists,
    trades,
    access,
    picks,
    eventPublisher
  }
}
