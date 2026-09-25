import { IHttpServerComponent } from '@dcl/core-commons'
import { Params } from '../../logic/http/params'
import { asJSON } from '../../logic/http/response'
import { AppComponents, Context } from '../../types'

/**
 * The search dropdown's one request: items, collections and creators matching a query, ranked, with
 * creator names resolved. Cached briefly: it answers on every keystroke and nothing in it changes by
 * the minute.
 */
export function createSearchSuggestHandler(
  components: Pick<AppComponents, 'searchSuggest'>
): IHttpServerComponent.IRequestHandler<Context<'/v3/catalog/suggest'>> {
  const { searchSuggest } = components

  return async context => {
    const params = new Params(context.url.searchParams)
    const filters = {
      search: params.getString('search', '') ?? '',
      items: params.getNumber('items'),
      collections: params.getNumber('collections'),
      creators: params.getNumber('creators')
    }

    return asJSON(async () => searchSuggest.suggest(filters), {
      'Cache-Control': 'public,max-age=60,s-maxage=60'
    })
  }
}
