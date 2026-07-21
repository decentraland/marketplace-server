import { isErrorWithMessage } from '../../logic/errors'
import { AppComponents } from '../../types'
import { IShopNotifierComponent, NotifyItemOnSaleParams } from './types'

// Hard cap on how long the ping may take. The Shop endpoint is not on the critical path of trade
// creation, so a slow/unreachable Shop server must never delay us: after this we abort and move on.
const NOTIFY_TIMEOUT_MS = 2000

export async function createShopNotifierComponent(
  components: Pick<AppComponents, 'config' | 'logs' | 'fetch'>
): Promise<IShopNotifierComponent> {
  const { config, logs, fetch } = components
  const logger = logs.getLogger('shop-notifier')

  const shopServerUrl = await config.getString('SHOP_SERVER_URL')
  const notifyTriggerToken = await config.getString('NOTIFY_TRIGGER_TOKEN')
  // Feature is disabled cleanly unless BOTH the Shop URL and the shared secret are configured.
  const enabled = !!shopServerUrl && !!notifyTriggerToken

  if (!enabled) {
    logger.info('Shop notifier disabled: SHOP_SERVER_URL and/or NOTIFY_TRIGGER_TOKEN are not set')
  }

  async function notifyItemOnSale({ contractAddress, itemId }: NotifyItemOnSaleParams): Promise<void> {
    if (!enabled) {
      return
    }

    try {
      await fetch.fetch(`${shopServerUrl}/notify/item-on-sale`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${notifyTriggerToken}`
        },
        body: JSON.stringify({ contractAddress, itemId }),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS)
      })
    } catch (error) {
      // Swallow + log: notifying the waitlist is best-effort and must never surface to the caller.
      logger.warn(
        `Failed to notify shop that item ${contractAddress}-${itemId} went on sale: ${
          isErrorWithMessage(error) ? error.message : 'unknown error'
        }`
      )
    }
  }

  return { notifyItemOnSale }
}
