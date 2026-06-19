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
  context: Pick<HandlerContextWithPath<'manaTransfers', '/v1/wallets/:address/mana-transfers'>, 'components' | 'params'>
) {
  const {
    components: { manaTransfers },
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
    return {
      status: StatusCode.INTERNAL_SERVER_ERROR,
      body: {
        ok: false,
        message: isErrorWithMessage(e) ? e.message : 'Could not fetch MANA transfers'
      }
    }
  }
}
