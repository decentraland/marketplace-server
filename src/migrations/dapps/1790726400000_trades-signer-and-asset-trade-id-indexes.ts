import { MigrationBuilder } from 'node-pg-migrate'

const SCHEMA = 'marketplace'
// The same indexes, by name and definition, as GET /v2/trades adds: whichever migration runs first
// creates them and the other finds them, instead of the tables carrying two copies.
const INDEXES = [
  { table: 'trades', name: 'idx_trades_signer_created_at', columns: [{ name: 'signer' }, { name: 'created_at', sort: 'DESC' as const }] },
  { table: 'trade_assets', name: 'idx_trade_assets_trade_id', columns: [{ name: 'trade_id' }] }
]

// Per-signer reads (cancelled trades, a signer's trades) and every asset lookup filter on these columns,
// which had no index: a signer's cancelled trades seq-scanned both tables once per candidate.
// Concurrently, so the live tables keep taking writes while the indexes build; that needs no transaction.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.noTransaction()
  for (const { table, name, columns } of INDEXES) {
    // A concurrent build that failed leaves an INVALID index under the name, which IF NOT EXISTS would keep.
    const invalid = await pgm.db.select(
      `SELECT 1 FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = '${SCHEMA}' AND c.relname = '${name}' AND NOT i.indisvalid`
    )
    if (invalid.length > 0) {
      pgm.dropIndex({ schema: SCHEMA, name: table }, columns, { name, ifExists: true, concurrently: true })
    }
    pgm.createIndex({ schema: SCHEMA, name: table }, columns, { name, ifNotExists: true, concurrently: true })
  }
}

// No-op: the GET /v2/trades migrations may own these indexes, so rolling this one back must not drop them.
export async function down(): Promise<void> {
  return
}
