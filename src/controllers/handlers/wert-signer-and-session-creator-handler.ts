import { WertSession } from '../../ports/wert/api/types'
import { WertMessage } from '../../ports/wert/signer/types'
import { Target } from '../../ports/wert/types'
import { HTTPResponse, HandlerContextWithPath, StatusCode } from '../../types'

export async function createWertSignerAndSessionCreatorHandler(
  context: Pick<
    HandlerContextWithPath<'wertSigner' | 'wertApi', '/v1/wert/sign'>,
    'url' | 'components' | 'params' | 'request' | 'verification'
  >
): Promise<HTTPResponse<{ signature: string; sessionId: string }>> {
  const {
    verification,
    request,
    components: { wertSigner, wertApi }
  } = context
  const userAddress: string | undefined = verification?.auth.toLowerCase()
  const {
    message: wertMessage,
    session: wertSession,
    target
  }: { message: WertMessage; target?: Target; session: WertSession } = await request.json()

  if (
    !userAddress ||
    (!!userAddress && userAddress !== wertMessage.address.toLocaleLowerCase()) ||
    (!!userAddress && userAddress !== wertSession.wallet_address?.toLocaleLowerCase())
  ) {
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

  const [signature, { sessionId }] = await Promise.all([
    wertSigner.signMessage(wertMessage, target),
    wertApi.createSession(wertSession, target)
  ])

  return {
    status: StatusCode.OK,
    body: {
      ok: true,
      data: {
        signature,
        sessionId
      }
    }
  }
}
