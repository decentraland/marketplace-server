import { IHttpServerComponent } from '@well-known-components/interfaces'
import { CatalogSortBy, CatalogSortDirection } from '@dcl/schemas'
import { Params } from '../../logic/http/params'
import { asJSON } from '../../logic/http/response'
import { AppComponents, AuthenticatedContext } from '../../types'
import { getItemsParams } from './utils'

const DEFAULT_PAGE_SIZE = 20

export function createCatalogHandler(
  components: Pick<AppComponents, 'catalog'>
): IHttpServerComponent.IRequestHandler<AuthenticatedContext<'/catalog'>> {
  const { catalog } = components

  return async context => {
    const params = new Params(context.url.searchParams)
    const isV2 = context.url.pathname.includes('/v2/')
    const annonId = context.request.headers.get('X-Anonymous-Id')
    const searchId = context.request.headers.get('X-Search-Uuid')

    const onlyListing = params.getBoolean('onlyListing')
    const onlyMinting = params.getBoolean('onlyMinting')
    const sortBy = params.getValue<CatalogSortBy>('sortBy', CatalogSortBy) || CatalogSortBy.CHEAPEST
    const sortDirection = params.getValue<CatalogSortDirection>('sortDirection', CatalogSortDirection) || CatalogSortDirection.ASC

    const limit = params.getNumber('first', DEFAULT_PAGE_SIZE)
    const offset = params.getNumber('skip', 0)
    // @TODO: add favorites logic
    const pickedBy: string | undefined = context.verification?.auth.toLowerCase()

    return asJSON(async () => {
      return await catalog.fetch(
        {
          limit,
          offset,
          sortBy,
          sortDirection,
          onlyListing,
          onlyMinting,
          pickedBy,
          ...getItemsParams(params)
        },
        { searchId: searchId || '', anonId: annonId || '', isV2 }
      )
    })
  }
}
