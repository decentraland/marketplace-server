import { MigrationBuilder } from 'node-pg-migrate'
import { TradeType } from '@dcl/schemas'
import { TRADE_TYPE } from './1718991797670_trades-and-asset-trades-table'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addTypeValue(TRADE_TYPE, TradeType.PUBLIC_ITEM_ORDER)
  pgm.addTypeValue(TRADE_TYPE, TradeType.PUBLIC_NFT_ORDER)
}
