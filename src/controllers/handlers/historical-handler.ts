import { isErrorWithMessage } from '../../logic/errors'
import {
  BlockTooRecentError,
  HistoricalBusyError,
  HistoricalEstatesRequest,
  HistoricalNftsRequest,
  HistoricalRentalAssetsRequest,
  MAX_PAGE_SIZE
} from '../../ports/historical'
import { HandlerContextWithPath, StatusCode } from '../../types'

const DEFAULT_PAGE_SIZE = 100

/** When to retry a read turned away: a block too recent is a few minutes from being readable. */
const RETRY_AFTER_SECONDS = { tooRecent: 60, busy: 5 }

type Context<Path extends string> = Pick<HandlerContextWithPath<'historical' | 'logs', Path>, 'components' | 'request'>

/**
 * Answers a historical read. A block too recent, or too many reads at once, is worth retrying and says
 * when; anything else is logged and answered without its details, since this endpoint is public.
 */
async function answer<T>(context: Context<string>, read: () => Promise<T[]>, what: string) {
  try {
    return { status: StatusCode.OK, body: { ok: true, data: await read() } }
  } catch (e) {
    // The code tells the two apart: a block too recent is not a server in trouble.
    if (e instanceof BlockTooRecentError || e instanceof HistoricalBusyError) {
      const tooRecent = e instanceof BlockTooRecentError
      return {
        status: StatusCode.SERVICE_UNAVAILABLE,
        headers: { 'Retry-After': String(tooRecent ? RETRY_AFTER_SECONDS.tooRecent : RETRY_AFTER_SECONDS.busy) },
        body: { ok: false, code: tooRecent ? 'block-too-recent' : 'busy', message: e.message }
      }
    }
    context.components.logs
      .getLogger('Historical handler')
      .error(`Could not fetch the historical ${what}: ${isErrorWithMessage(e) ? e.message : String(e)}`)
    return { status: StatusCode.INTERNAL_SERVER_ERROR, body: { ok: false, message: `Could not fetch the ${what}` } }
  }
}

const page = (body: { first?: number | null; skip?: number | null }) => ({
  first: Math.min(body.first ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  skip: body.skip ?? 0
})

export async function getHistoricalNftsHandler(context: Context<'/v1/historical/nfts'>) {
  const body: HistoricalNftsRequest = await context.request.json()
  // Reading the owners at a block goes over every NFT the filters cover: they must narrow it.
  if (!body.category && !body.contractAddresses?.length) {
    return { status: StatusCode.BAD_REQUEST, body: { ok: false, message: 'A category or some contractAddresses are required.' } }
  }
  return answer(
    context,
    () =>
      context.components.historical.getNfts({
        block: body.block,
        owners: body.owners,
        category: body.category ?? undefined,
        contractAddresses: body.contractAddresses ?? undefined,
        itemTypes: body.itemTypes ?? undefined,
        estateSizeGt: body.estateSizeGt ?? undefined,
        idGt: body.idGt ?? undefined,
        ...page(body)
      }),
    'NFTs'
  )
}

export async function getHistoricalEstatesHandler(context: Context<'/v1/historical/estates'>) {
  const body: HistoricalEstatesRequest = await context.request.json()
  return answer(
    context,
    () =>
      context.components.historical.getEstates({
        block: body.block,
        tokenIds: body.tokenIds,
        sizeGt: body.sizeGt ?? undefined,
        ...page(body)
      }),
    'estates'
  )
}

export async function getHistoricalRentalAssetsHandler(context: Context<'/v1/historical/rental-assets'>) {
  const body: HistoricalRentalAssetsRequest = await context.request.json()
  return answer(
    context,
    () =>
      context.components.historical.getRentalAssets({
        block: body.block,
        lessors: body.lessors,
        contractAddresses: body.contractAddresses ?? undefined,
        isClaimed: body.isClaimed ?? undefined,
        ...page(body)
      }),
    'rental assets'
  )
}
