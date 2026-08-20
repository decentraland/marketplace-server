/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const SCHEMA = 'marketplace'
export const TRADES_TABLE = 'trades'
export const shorthands: ColumnDefinitions | undefined = undefined

/**
 * Stores each trade's EIP-712 digest.
 *
 * The V3 marketplace identifies a trade by this digest rather than by `keccak256(signature bytes)`, so a
 * V3 `SignatureCancelled` event carries the digest. Without a digest column there is nothing to join
 * those cancellations against, and a cancelled V3 listing would keep reporting as open.
 *
 * Nullable and backfill-free on purpose: the digest depends on the marketplace version a trade was signed
 * against, which cannot be recovered from the stored row alone, so existing rows keep a NULL and continue
 * to be matched by `hashed_signature` the way they always were.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn(
    { schema: SCHEMA, name: TRADES_TABLE },
    {
      trade_digest: {
        type: 'text',
        notNull: false
      }
    },
    { ifNotExists: true }
  )

  pgm.createIndex({ schema: SCHEMA, name: TRADES_TABLE }, 'trade_digest', { ifNotExists: true })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex({ schema: SCHEMA, name: TRADES_TABLE }, 'trade_digest', { ifExists: true })
  pgm.dropColumn({ schema: SCHEMA, name: TRADES_TABLE }, 'trade_digest')
}
