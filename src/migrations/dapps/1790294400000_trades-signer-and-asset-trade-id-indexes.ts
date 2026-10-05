import { MigrationBuilder } from 'node-pg-migrate'

const SCHEMA = 'marketplace'

// Per-signer reads (cancelled trades, a signer's trades) and every asset lookup filter on these columns,
// which had no index: a signer's cancelled trades seq-scanned both tables once per candidate.
// Concurrently, so the live tables keep taking writes while the indexes build; that needs no transaction.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.noTransaction()
  pgm.createIndex({ schema: SCHEMA, name: 'trades' }, 'signer', { ifNotExists: true, concurrently: true })
  pgm.createIndex({ schema: SCHEMA, name: 'trade_assets' }, 'trade_id', { ifNotExists: true, concurrently: true })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.noTransaction()
  pgm.dropIndex({ schema: SCHEMA, name: 'trades' }, 'signer', { ifExists: true, concurrently: true })
  pgm.dropIndex({ schema: SCHEMA, name: 'trade_assets' }, 'trade_id', { ifExists: true, concurrently: true })
}
