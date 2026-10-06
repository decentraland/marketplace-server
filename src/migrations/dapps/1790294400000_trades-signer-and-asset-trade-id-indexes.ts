import { MigrationBuilder } from 'node-pg-migrate'

const SCHEMA = 'marketplace'
const INDEXES = [
  { table: 'trades', column: 'signer' },
  { table: 'trade_assets', column: 'trade_id' }
]

// Per-signer reads (cancelled trades, a signer's trades) and every asset lookup filter on these columns,
// which had no index: a signer's cancelled trades seq-scanned both tables once per candidate.
// Concurrently, so the live tables keep taking writes while the indexes build; that needs no transaction.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.noTransaction()
  for (const { table, column } of INDEXES) {
    // A concurrent build that failed leaves an INVALID index under the name, which IF NOT EXISTS would keep.
    const invalid = await pgm.db.select(
      `SELECT 1 FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = '${SCHEMA}' AND c.relname = '${table}_${column}_index' AND NOT i.indisvalid`
    )
    if (invalid.length > 0) {
      pgm.dropIndex({ schema: SCHEMA, name: table }, column, { ifExists: true, concurrently: true })
    }
    pgm.createIndex({ schema: SCHEMA, name: table }, column, { ifNotExists: true, concurrently: true })
  }
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.noTransaction()
  for (const { table, column } of INDEXES) {
    pgm.dropIndex({ schema: SCHEMA, name: table }, column, { ifExists: true, concurrently: true })
  }
}
