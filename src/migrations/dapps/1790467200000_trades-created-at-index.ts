/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'

// Backs the default order of GET /v2/trades when no signer is given.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_trades_created_at_id ON marketplace.trades (created_at DESC, id);')
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP INDEX IF EXISTS marketplace.idx_trades_created_at_id;')
}
