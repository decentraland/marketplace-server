import { WertMessage } from '../../ports/wert-signer/types'
import { HTTPResponse, HandlerContextWithPath, StatusCode } from '../../types'

export async function createWertSignerHandler(
  context: Pick<HandlerContextWithPath<'wertSigner', '/v1/wert/sign'>, 'url' | 'components' | 'params' | 'request' | 'verification'>
): Promise<HTTPResponse<string>> {
  const {
    verification,
    request,
    components: { wertSigner }
  } = context
  const userAddress: string | undefined = verification?.auth.toLowerCase()
  const body: WertMessage = await request.json()

  if (!userAddress || (!!userAddress && userAddress !== body.address.toLocaleLowerCase())) {
    return {
      status: StatusCode.UNAUTHORIZED,
      body: {
        ok: false,
        message: 'Unauthorized'
      }
    }
  }

  const signature = wertSigner.signMessage(body)
  return {
    status: StatusCode.OK,
    body: {
      ok: true,
      data: signature
    }
  }
}
