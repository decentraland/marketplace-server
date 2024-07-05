import { IPgComponent } from '@well-known-components/pg-component'
import { TradeAssetType, TradeCreation } from '@dcl/schemas'
import { DuplicatedBidError, InvalidTradeStructureError } from './errors'
import { getDuplicateBidQuery } from './queries'

export async function validateTradeByType(trade: TradeCreation, client: IPgComponent): Promise<boolean> {
  const pgClient = await client.getPool().connect()
  try {
    if (trade.type === 'bid') {
      // validate bid structure
      if (
        trade.sent.length !== 1 ||
        trade.sent[0].assetType !== TradeAssetType.ERC20 ||
        trade.received.length !== 1 ||
        ![TradeAssetType.ERC721, TradeAssetType.COLLECTION_ITEM].includes(trade.received[0].assetType)
      ) {
        throw new InvalidTradeStructureError(trade.type)
      }

      const duplicateBid = await client.query(getDuplicateBidQuery(trade))
      if (duplicateBid.rowCount > 0) {
        throw new DuplicatedBidError()
      }
    }

    return true
  } catch (e) {
    console.error(e)
    throw e
  } finally {
    await pgClient.release()
  }
}
