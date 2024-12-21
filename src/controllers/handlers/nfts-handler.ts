import { NFTFilters } from '@dcl/schemas'
import { isErrorWithMessage } from '../../logic/errors'
import { Params } from '../../logic/http/params'
import { InvalidSearchByTenantAndOwnerError, InvalidTokenIdError, MissingContractAddressParamError } from '../../ports/nfts/errors'
import { HandlerContextWithPath, StatusCode } from '../../types'
import { getNFTParams } from './utils'

export async function getNFTsHandler(context: Pick<HandlerContextWithPath<'nfts', '/v1/nfts'>, 'components' | 'url' | 'verification'>) {
  try {
    const {
      components: { nfts }
    } = context

    const params = new Params(context.url.searchParams)

    const caller: string | undefined = context.verification?.auth.toLowerCase()

    const filters: NFTFilters = getNFTParams(params)

    const { data, total } = await nfts.getNFTs(
      {
        ...filters
      },
      caller
    )

    return {
      status: StatusCode.OK,
      body: {
        data,
        total
      }
    }
  } catch (e) {
    if (
      e instanceof InvalidSearchByTenantAndOwnerError ||
      e instanceof InvalidTokenIdError ||
      e instanceof MissingContractAddressParamError
    ) {
      return {
        status: StatusCode.BAD_REQUEST,
        body: {
          ok: false,
          message: e.message
        }
      }
    }

    return {
      status: StatusCode.BAD_REQUEST,
      body: {
        ok: false,
        message: isErrorWithMessage(e) ? e.message : 'Could not fetch NFTs'
      }
    }
  }
}
