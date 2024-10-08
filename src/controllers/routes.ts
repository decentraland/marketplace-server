import { Router } from '@well-known-components/http-server'
import * as authorizationMiddleware from 'decentraland-crypto-middleware'
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
import { addTradeHandler, getTradeAcceptedEventHandler, getTradeHandler, getTradesHandler } from './handlers/trades-handler'
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

  setupFavoritesRouter(router, { components })

  return router
}
