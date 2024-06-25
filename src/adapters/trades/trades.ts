import { Network, Trade, TradeChecks } from '@dcl/schemas'
import { DBTrade, DBTradeAsset } from '../../ports/trades'
import { fromMillisecondsToSeconds } from '../../logic/date'

export function fromDbTradeWithAssetsToTrade(dbTrade: DBTrade, assets: DBTradeAsset[]): Trade {
  return {
    id: dbTrade.id,
    network: dbTrade.network as Network,
    chainId: dbTrade.chainId,
    checks: dbTrade.checks as TradeChecks,
    createdAt: fromMillisecondsToSeconds(dbTrade.createdAt.getTime())
  }
}
