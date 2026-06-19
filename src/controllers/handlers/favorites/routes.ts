import { wellKnownComponents } from '@dcl/crypto-middleware'
import { Router } from '@dcl/http-server'
import { AccessBodySchema } from '../../../ports/favorites/access'
import { AddPickInListSchema, ListCreationSchema, ListUpdateSchema } from '../../../ports/favorites/lists'
import { PickUnpickInBulkSchema } from '../../../ports/favorites/picks'
import { GlobalContext } from '../../../types'
import { validateNotKernelSceneSigner } from '../../utils'
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
    wellKnownComponents({
      optional: true,
      expiration: FIVE_MINUTES,
      metadataValidator: validateNotKernelSceneSigner
    }),
    getPicksByListIdHandler
  )

  router.post(
    '/v1/lists/:id/picks',
    wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES,
      metadataValidator: validateNotKernelSceneSigner
    }),
    schemaValidator.withSchemaValidatorMiddleware(AddPickInListSchema),
    createPickInListHandler
  )

  router.delete(
    '/v1/lists/:id/picks/:itemId',
    wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES,
      metadataValidator: validateNotKernelSceneSigner
    }),
    deletePickInListHandler
  )

  router.get(
    '/v1/picks/:itemId/stats',
    wellKnownComponents({
      optional: true,
      expiration: FIVE_MINUTES,
      metadataValidator: validateNotKernelSceneSigner
    }),
    getPickStatsOfItemHandler
  )

  router.get('/v1/picks/stats', getPickStatsHandler)

  router.get(
    '/v1/picks/:itemId',
    wellKnownComponents({
      optional: true,
      expiration: FIVE_MINUTES,
      metadataValidator: validateNotKernelSceneSigner
    }),
    getPicksByItemIdHandler
  )

  router.post(
    '/v1/picks/:itemId',
    wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES,
      metadataValidator: validateNotKernelSceneSigner
    }),
    schemaValidator.withSchemaValidatorMiddleware(PickUnpickInBulkSchema),
    pickAndUnpickInBulkHandler
  )

  router.get(
    '/v1/lists/:id',
    wellKnownComponents({
      optional: true,
      expiration: FIVE_MINUTES,
      metadataValidator: validateNotKernelSceneSigner
    }),
    getListHandler
  )

  router.get(
    '/v1/lists',
    wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES,
      metadataValidator: validateNotKernelSceneSigner
    }),
    getListsHandler
  )

  router.post(
    '/v1/lists',
    wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES,
      metadataValidator: validateNotKernelSceneSigner
    }),
    schemaValidator.withSchemaValidatorMiddleware(ListCreationSchema),
    createListHandler
  )

  router.put(
    '/v1/lists/:id',
    wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES,
      metadataValidator: validateNotKernelSceneSigner
    }),
    schemaValidator.withSchemaValidatorMiddleware(ListUpdateSchema),
    updateListHandler
  )

  router.post(
    '/v1/lists/:id/access',
    wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES,
      metadataValidator: validateNotKernelSceneSigner
    }),
    schemaValidator.withSchemaValidatorMiddleware(AccessBodySchema),
    createAccessHandler
  )

  router.delete(
    '/v1/lists/:id/access',
    wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES,
      metadataValidator: validateNotKernelSceneSigner
    }),
    schemaValidator.withSchemaValidatorMiddleware(AccessBodySchema),
    deleteAccessHandler
  )

  router.delete(
    '/v1/lists/:id',
    wellKnownComponents({
      optional: false,
      expiration: FIVE_MINUTES,
      metadataValidator: validateNotKernelSceneSigner
    }),
    deleteListHandler
  )

  return Promise.resolve()
}
