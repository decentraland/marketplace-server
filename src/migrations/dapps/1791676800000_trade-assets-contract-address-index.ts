import { MigrationBuilder } from 'node-pg-migrate'

const SCHEMA = 'marketplace'
const TABLE = 'trade_assets'
const INDEX_NAME = 'idx_trade_assets_contract_address'
const COLUMNS = ['contract_address']

// GET /v1/bids for one NFT resolves its trades by asset contract before aggregating them; without this
// index that lookup seq-scans every trade asset on each request.
// Concurrently, so the live table keeps taking writes while the index builds; that needs no transaction.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.noTransaction()
  // A concurrent build that failed leaves an INVALID index under the name, which IF NOT EXISTS would keep.
  const invalid = await pgm.db.select(
    `SELECT 1 FROM pg_index i
     JOIN pg_class c ON c.oid = i.indexrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = '${SCHEMA}' AND c.relname = '${INDEX_NAME}' AND NOT i.indisvalid`
  )
  if (invalid.length > 0) {
    pgm.dropIndex({ schema: SCHEMA, name: TABLE }, COLUMNS, { name: INDEX_NAME, ifExists: true, concurrently: true })
  }
  pgm.createIndex({ schema: SCHEMA, name: TABLE }, COLUMNS, { name: INDEX_NAME, ifNotExists: true, concurrently: true })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.noTransaction()
  pgm.dropIndex({ schema: SCHEMA, name: TABLE }, COLUMNS, { name: INDEX_NAME, ifExists: true, concurrently: true })
}
