import { isErrorWithMessage } from '../../logic/errors'
import { Params } from '../../logic/http/params'
import { HandlerContextWithPath, StatusCode } from '../../types'

export async function getTrendingsHandler(
  context: Pick<HandlerContextWithPath<'trendings', '/v1/trendings'>, 'components' | 'url' | 'verification'>
) {
  try {
    const {
      components: { trendings }
    } = context

    const params = new Params(context.url.searchParams)

    const responseHeaders = {
      'Cache-Control': 'public,max-age=3600,s-maxage=3600'
    }

    const size = params.getNumber('size')
    // Social emotes are included by default; excluded only when includeSocialEmotes=false is explicitly set
    const includeSocialEmotes = params.getString('includeSocialEmotes') !== 'false'

    const pickedBy: string | undefined = context.verification?.auth.toLowerCase()

    return {
      status: StatusCode.OK,
      headers: responseHeaders, //TODO: see headers
      body: { data: await trendings.fetch({ size, pickedBy, includeSocialEmotes }) }
    }
  } catch (e) {
    return {
      status: StatusCode.BAD_REQUEST,
      body: {
        ok: false,
        message: isErrorWithMessage(e) ? e.message : 'Could not fetch prices'
      }
    }
  }
}
