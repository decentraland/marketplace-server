/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'

// Every trade read joins trade_assets on trade_id (GET /v1/trades/:id, its status, the activity feed),
// and the table had no index on it.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_trade_assets_trade_id ON marketplace.trade_assets (trade_id);')
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP INDEX IF EXISTS marketplace.idx_trade_assets_trade_id;')
}
