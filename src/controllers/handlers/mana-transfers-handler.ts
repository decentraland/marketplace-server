import { isAddress } from '../../logic/address'
import { isErrorWithMessage } from '../../logic/errors'
import { HandlerContextWithPath, StatusCode } from '../../types'

/**
 * Handler for GET /v1/wallets/:address/mana-transfers
 *
 * Returns the wallet's MANA ERC20 transfer history (sends, receiveds, bridge swaps and withdraws)
 * across Ethereum and Polygon, read on-chain via eth_getLogs. Public read — no authentication.
 */
export async function getManaTransfersHandler(
  context: Pick<HandlerContextWithPath<'manaTransfers' | 'logs', '/v1/wallets/:address/mana-transfers'>, 'components' | 'params'>
) {
  const {
    components: { manaTransfers, logs },
    params: { address }
  } = context

  if (!isAddress(address)) {
    return {
      status: StatusCode.BAD_REQUEST,
      body: {
        ok: false,
        message: 'Invalid address'
      }
    }
  }

  try {
    const { data, total } = await manaTransfers.getManaTransfers(address)

    return {
      status: StatusCode.OK,
      body: {
        data,
        total
      }
    }
  } catch (e) {
    // Public, unauthenticated endpoint: log the real error server-side but never surface RPC /
    // provider / internal details to the caller — always return the generic message.
    logs.getLogger('mana-transfers-handler').error('Failed to fetch MANA transfers', {
      address,
      error: isErrorWithMessage(e) ? e.message : String(e)
    })
    return {
      status: StatusCode.INTERNAL_SERVER_ERROR,
      body: {
        ok: false,
        message: 'Could not fetch MANA transfers'
      }
    }
  }
}
