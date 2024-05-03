import { Router } from '@well-known-components/http-server'
import * as authorizationMiddleware from 'decentraland-crypto-middleware'
import { AccessBodySchema } from '../../../ports/favorites/access'
import { AddPickInListSchema, ListCreationSchema, ListUpdateSchema } from '../../../ports/favorites/lists'
import { PickUnpickInBulkSchema } from '../../../ports/favorites/picks'
import { GlobalContext } from '../../../types'
import {
  createPickInListHandler,
  deletePickInListHandler,
  getPicksByListIdHandler,
  deleteAccessHandler,
  createListHandler,
  deleteListHandler,
  getListsHandler,
  createAccessHandler,
  getListHandler,
  updateListHandler
} from './lists-handlers'
import { getPickStatsHandler, getPicksByItemIdHandler, getPickStatsOfItemHandler, pickAndUnpickInBulkHandler } from './picks-handlers'

const FIVE_MINUTES = 5 * 60 * 1000

export function setupFavoritesRouter(router: Router<GlobalContext>, { components: { schemaValidator } }: GlobalContext): Promise<void> {
  router.get(
    '/v1/lists/:id/picks',
    authorizationMiddleware.wellKnownComponents({
      optional: true,
      expiration: FIVE_MINUTES
    }),
    getPicksByListIdHandler
  )

  router.post(
    '/v1/lists/:id/picks',
    authorizationMiddleware.wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES
    }),
    schemaValidator.withSchemaValidatorMiddleware(AddPickInListSchema),
    createPickInListHandler
  )

  router.delete(
    '/v1/lists/:id/picks/:itemId',
    authorizationMiddleware.wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES
    }),
    deletePickInListHandler
  )

  router.get(
    '/v1/picks/:itemId/stats',
    authorizationMiddleware.wellKnownComponents({
      optional: true,
      expiration: FIVE_MINUTES
    }),
    getPickStatsOfItemHandler
  )

  router.get('/v1/picks/stats', getPickStatsHandler)

  router.get(
    '/v1/picks/:itemId',
    authorizationMiddleware.wellKnownComponents({
      optional: true,
      expiration: FIVE_MINUTES
    }),
    getPicksByItemIdHandler
  )

  router.post(
    '/v1/picks/:itemId',
    authorizationMiddleware.wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES
    }),
    schemaValidator.withSchemaValidatorMiddleware(PickUnpickInBulkSchema),
    pickAndUnpickInBulkHandler
  )

  router.get(
    '/v1/lists/:id',
    authorizationMiddleware.wellKnownComponents({
      optional: true,
      expiration: FIVE_MINUTES
    }),
    getListHandler
  )

  router.get(
    '/v1/lists',
    authorizationMiddleware.wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES
    }),
    getListsHandler
  )

  router.post(
    '/v1/lists',
    authorizationMiddleware.wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES
    }),
    schemaValidator.withSchemaValidatorMiddleware(ListCreationSchema),
    createListHandler
  )

  router.put(
    '/v1/lists/:id',
    authorizationMiddleware.wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES
    }),
    schemaValidator.withSchemaValidatorMiddleware(ListUpdateSchema),
    updateListHandler
  )

  router.post(
    '/v1/lists/:id/access',
    authorizationMiddleware.wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES
    }),
    schemaValidator.withSchemaValidatorMiddleware(AccessBodySchema),
    createAccessHandler
  )

  router.delete(
    '/v1/lists/:id/access',
    authorizationMiddleware.wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES
    }),
    schemaValidator.withSchemaValidatorMiddleware(AccessBodySchema),
    deleteAccessHandler
  )

  router.delete(
    '/v1/lists/:id',
    authorizationMiddleware.wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES
    }),
    deleteListHandler
  )

  return Promise.resolve()
}