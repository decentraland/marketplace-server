/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'

// Backs loading the assets of a GET /v2/trades page by trade id.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_trade_assets_trade_id ON marketplace.trade_assets (trade_id);')
}

// No-op: another migration may own this index, so rolling this one back must not drop it.
export async function down(): Promise<void> {
  return
}
