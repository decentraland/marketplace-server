import { Router } from '@well-known-components/http-server'
import * as authorizationMiddleware from 'decentraland-crypto-middleware'
import { createTradesViewAuthMiddleware } from '../logic/http/auth'
import { TradeCreationSchema } from '../ports/trades/schemas'
import { GlobalContext } from '../types'
import { createBalanceHandler } from './handlers/balance-handler'
import { getBidsHandler } from './handlers/bids-handler'
import { createCatalogHandler } from './handlers/catalog-handler'
import { createENSImageGeratorHandler } from './handlers/ens'
import { setupFavoritesRouter } from './handlers/favorites/routes'
import { getItemsHandler } from './handlers/items-handler'
import { getNFTsHandler } from './handlers/nfts-handler'
import { getOrdersHandler } from './handlers/orders-handler'
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
import { createTransakHandler } from './handlers/transak-handler'
import { getTrendingsHandler } from './handlers/trending-handler'
import { getVolumeHandler } from './handlers/volume-handler'
import { createWertSignerHandler } from './handlers/wert-signer-handler'
import { validateNotKernelSceneSigner, validateAuthMetadata } from './utils'

const FIVE_MINUTES = 5 * 60 * 1000

// We return the entire router because it will be easier to test than a whole server
export async function setupRouter(globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const { components } = globalContext
  const router = new Router<GlobalContext>()

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
    createWertSignerHandler
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
  router.get('/v1/ens/generate', createENSImageGeratorHandler)
  router.get('/v1/:chainId/address/:wallet/balance', createBalanceHandler)

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

  setupFavoritesRouter(router, { components })

  return router
}
