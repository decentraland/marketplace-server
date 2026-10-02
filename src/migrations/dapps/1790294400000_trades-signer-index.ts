/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'

// Backs the `signer` filter of GET /v2/trades, which orders by created_at DESC.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_trades_signer_created_at ON marketplace.trades (signer, created_at DESC);')
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP INDEX IF EXISTS marketplace.idx_trades_signer_created_at;')
}
