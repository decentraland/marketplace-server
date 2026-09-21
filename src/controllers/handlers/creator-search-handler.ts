import { IHttpServerComponent } from '@dcl/core-commons'
import { CREATOR_SEARCH_DEFAULT_LIMIT } from '../../logic/catalog/creator-profiles'
import { Params } from '../../logic/http/params'
import { asJSON } from '../../logic/http/response'
import { AppComponents, Context } from '../../types'

/**
 * Creators matching a query, for the search dropdown. Replaces the three calls the Shop used to make —
 * NAMEs matching the text, which of their owners sell anything, what each one is called — with one that
 * is also ranked, which is what the first of the three was not.
 */
export function createCreatorSearchHandler(
  components: Pick<AppComponents, 'creatorProfiles'>
): IHttpServerComponent.IRequestHandler<Context<'/v3/catalog/creators/search'>> {
  const { creatorProfiles } = components

  return async context => {
    const params = new Params(context.url.searchParams)
    const search = params.getString('search', '')?.trim() ?? ''
    const first = params.getNumber('first', CREATOR_SEARCH_DEFAULT_LIMIT) ?? CREATOR_SEARCH_DEFAULT_LIMIT

    if (!search) {
      return { status: 400, body: { ok: false, message: 'The search parameter is required' } }
    }

    return asJSON(async () => creatorProfiles.search({ search, first }), {
      'Cache-Control': 'public,max-age=60,s-maxage=60'
    })
  }
}
