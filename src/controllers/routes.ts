import { Router } from '@well-known-components/http-server'
import { bearerTokenMiddleware } from '@dcl/platform-server-commons'
import * as authorizationMiddleware from 'decentraland-crypto-middleware'
import { createTradesViewAuthMiddleware } from '../logic/http/auth'
import { TradeCreationSchema } from '../ports/trades/schemas'
import { WidgetOptionsSchema } from '../ports/transak'
import { GlobalContext } from '../types'
import { getAccountsHandler } from './handlers/accounts-handler'
import { getBidsHandler } from './handlers/bids-handler'
import { createCatalogHandler } from './handlers/catalog-handler'
import { getCollectionsHandler } from './handlers/collections-handler'
import { createENSImageGeratorHandler } from './handlers/ens'
import { setupFavoritesRouter } from './handlers/favorites/routes'
import { getItemsHandler } from './handlers/items-handler'
import { getNFTsHandler } from './handlers/nfts-handler'
import { getOrdersHandler } from './handlers/orders-handler'
import { getOwnersHandler } from './handlers/owners-handler'
import { pingHandler } from './handlers/ping-handler'
import { getPricesHandler } from './handlers/prices-handler'
import { getRankingsHandler } from './handlers/rankings-handler'
import { getSalesHandler } from './handlers/sales-handler'
import { getStatsHandler } from './handlers/stats-handler'
import {
  addTradeHandler,
  getTradeAcceptedEventHandler,
  getTradeHandler,
  getTradesHandler,
  recreateTradesMaterializedViewHandler
} from './handlers/trades-handler'
import { createTransakHandler, createTransakWidgetHandler, refreshTransakAccessTokenHandler } from './handlers/transak-handler'
import { getTrendingsHandler } from './handlers/trending-handler'
import { getUserEmotesHandler, getUserEmotesUrnTokenHandler, getUserGroupedEmotesHandler } from './handlers/user-assets/emotes-handler'
import { getUserNamesHandler, getUserNamesOnlyHandler } from './handlers/user-assets/names-handler'
import {
  getUserWearablesHandler,
  getUserWearablesUrnTokenHandler,
  getUserGroupedWearablesHandler
} from './handlers/user-assets/wearables-handler'
import { getVolumeHandler } from './handlers/volume-handler'
import { createWertSignerAndSessionCreatorHandler } from './handlers/wert-signer-and-session-creator-handler'
import { validateNotKernelSceneSigner, validateAuthMetadata } from './utils'

const FIVE_MINUTES = 5 * 60 * 1000

// We return the entire router because it will be easier to test than a whole server
export async function setupRouter(globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const { components } = globalContext
  const { config } = components
  const router = new Router<GlobalContext>()
  const transakAccessTokenAuth = await config.requireString('TRANSAK_REFRESH_ACCESS_TOKEN_AUTH')

  router.get('/ping', pingHandler)
  router.get(
    '/v1/catalog',
    authorizationMiddleware.wellKnownComponents({
      optional: true,
      expiration: FIVE_MINUTES,
      verifyMetadataContent: validateNotKernelSceneSigner
    }),
    createCatalogHandler(components)
  )
  router.get(
    '/v2/catalog',
    authorizationMiddleware.wellKnownComponents({
      optional: true,
      expiration: FIVE_MINUTES,
      verifyMetadataContent: validateNotKernelSceneSigner
    }),
    createCatalogHandler(components)
  )
  router.post(
    '/v1/wert/sign',
    authorizationMiddleware.wellKnownComponents({
      optional: true,
      expiration: FIVE_MINUTES,
      verifyMetadataContent: validateNotKernelSceneSigner
    }),
    createWertSignerAndSessionCreatorHandler
  )
  router.get(
    '/v1/transak/orders/:id',
    authorizationMiddleware.wellKnownComponents({
      optional: true,
      expiration: FIVE_MINUTES,
      verifyMetadataContent: validateNotKernelSceneSigner
    }),
    createTransakHandler
  )
  router.post(
    '/v1/transak/widget-url',
    components.schemaValidator.withSchemaValidatorMiddleware(WidgetOptionsSchema),
    createTransakWidgetHandler
  )
  router.put('/v1/transak/access-token', bearerTokenMiddleware(transakAccessTokenAuth), refreshTransakAccessTokenHandler)
  router.get('/v1/ens/generate', createENSImageGeratorHandler)

  router.get('/v1/trades', getTradesHandler)
  router.post(
    '/v1/trades',
    authorizationMiddleware.wellKnownComponents({
      verifyMetadataContent: validateAuthMetadata(['dcl:marketplace', 'dcl:builder'], 'dcl:create-trade')
    }),
    components.schemaValidator.withSchemaValidatorMiddleware(TradeCreationSchema),
    addTradeHandler
  )

  router.get('/v1/trades/:id', getTradeHandler)

  router.get('/v1/bids', getBidsHandler)
  router.get('/v1/trades/:hashedSignature/accept', getTradeAcceptedEventHandler)

  router.get(
    '/v1/nfts',
    authorizationMiddleware.wellKnownComponents({
      optional: true,
      verifyMetadataContent: validateNotKernelSceneSigner,
      expiration: FIVE_MINUTES
    }),
    getNFTsHandler
  )

  router.get('/v1/orders', getOrdersHandler)
  router.get('/v1/collections', getCollectionsHandler)
  router.get('/v1/accounts', getAccountsHandler)
  router.get('/v1/owners', getOwnersHandler)

  router.get(
    '/v1/items',
    authorizationMiddleware.wellKnownComponents({
      optional: true,
      verifyMetadataContent: validateNotKernelSceneSigner,
      expiration: FIVE_MINUTES
    }),
    getItemsHandler
  )

  router.get('/v1/sales', getSalesHandler)
  router.get('/v1/prices', getPricesHandler)
  router.get('/v1/trendings', getTrendingsHandler)
  router.get('/v1/stats/:category/:stat', getStatsHandler)
  router.get('/v1/rankings/:entity/:timeframe', getRankingsHandler)
  router.get('/v1/volume/:timeframe', getVolumeHandler)
  router.post('/v1/trades/materialized-view/recreate', createTradesViewAuthMiddleware(), recreateTradesMaterializedViewHandler)

  // User assets endpoints
  router.get('/v1/users/:address/wearables', getUserWearablesHandler)
  router.get('/v1/users/:address/wearables/urn-token', getUserWearablesUrnTokenHandler)
  router.get('/v1/users/:address/wearables/grouped', getUserGroupedWearablesHandler)
  router.get('/v1/users/:address/emotes', getUserEmotesHandler)
  router.get('/v1/users/:address/emotes/urn-token', getUserEmotesUrnTokenHandler)
  router.get('/v1/users/:address/emotes/grouped', getUserGroupedEmotesHandler)
  router.get('/v1/users/:address/names', getUserNamesHandler)
  router.get('/v1/users/:address/names/names-only', getUserNamesOnlyHandler)

  setupFavoritesRouter(router, { components })

  return router
}
