/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'

const SCHEMA = 'marketplace'

// The closing MANA/USD rate of each UTC day, read from the Polygon Chainlink feed, so a sale can be shown
// in what it was worth on the day it happened. Filled by a job; nothing else writes to it.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(
    { schema: SCHEMA, name: 'mana_usd_daily' },
    {
      day: { type: 'date', notNull: true, primaryKey: true },
      usd: { type: 'numeric', notNull: true },
      // The proxy round the close was read from, so any stored rate can be checked against the chain.
      round_id: { type: 'numeric', notNull: true },
      created_at: { type: 'timestamptz(3)', notNull: true, default: pgm.func('now()::timestamptz(3)') }
    }
  )
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable({ schema: SCHEMA, name: 'mana_usd_daily' })
}
