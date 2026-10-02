/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'

// Back GET /v2/trades: its default order when no signer is given, and loading the assets of a page of trades.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_trades_created_at_id ON marketplace.trades (created_at DESC, id);')
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_trade_assets_trade_id ON marketplace.trade_assets (trade_id);')
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP INDEX IF EXISTS marketplace.idx_trade_assets_trade_id;')
  pgm.sql('DROP INDEX IF EXISTS marketplace.idx_trades_created_at_id;')
}
