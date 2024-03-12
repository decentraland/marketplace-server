import { Target, WertMessage } from '../../ports/wert-signer/types'
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
  const { target, ...wertMessage }: WertMessage & { target?: Target } = await request.json()

  if (!userAddress || (!!userAddress && userAddress !== wertMessage.address.toLocaleLowerCase())) {
    return {
      status: StatusCode.UNAUTHORIZED,
      body: {
        ok: false,
        message: 'Unauthorized'
      }
    }
  }

  if (target && !Object.values(Target).includes(target)) {
    return {
      status: StatusCode.BAD_REQUEST,
      body: {
        ok: false,
        message: 'Invalid target'
      }
    }
  }

  const signature = wertSigner.signMessage(wertMessage, target)
  return {
    status: StatusCode.OK,
    body: {
      ok: true,
      data: signature
    }
  }
}
