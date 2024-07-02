import { PoolClient } from 'pg'
import { TradeAssetType, TradeCreation } from '@dcl/schemas'
import { StatusCode } from '../../types'
import { RequestError } from '../../utils'
import { getDuplicateBidQuery } from './queries'

export async function validateTradeByType(trade: TradeCreation, client: PoolClient): Promise<boolean> {
  if (trade.type === 'bid') {
    // validate bid structure
    if (
      trade.sent.length !== 1 ||
      trade.sent[0].assetType !== TradeAssetType.ERC20 ||
      trade.received.length !== 1 ||
      trade.received[0].assetType !== TradeAssetType.ERC721
    ) {
      throw new RequestError(StatusCode.BAD_REQUEST, 'Invalid bid structure')
    }

    const duplicateBid = await client.query(getDuplicateBidQuery(trade))
    if (duplicateBid.rowCount > 0) {
      throw new RequestError(StatusCode.CONFLICT, 'There is already an active bid created for that nft')
    }
  }

  return true
}
