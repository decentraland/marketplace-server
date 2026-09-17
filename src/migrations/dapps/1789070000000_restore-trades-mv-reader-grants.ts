/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'
import { TRADES_MV_READER_GRANT_SQL } from '../../logic/trades/materialized-view'

/**
 * Restores the direct SELECT grants on mv_trades.
 *
 * Migration 1787300000000 recreates the view, and `DROP MATERIALIZED VIEW` discards the object's whole
 * ACL. Restoring the owner afterwards does not bring the grants back, and nothing inside the app notices:
 * every reader that goes through membership of `mv_trades_owner` keeps working. Only consumers holding a
 * direct grant lose access, and they lose it silently — the warehouse replication of this view stopped on
 * 2026-08-26 and was not spotted for two weeks.
 *
 * Applies the same constant the runtime recreate applies, so a database brought up by migrations and one
 * brought up by POST /v1/trades/materialized-view/recreate end with the same grants.
 *
 * Idempotent: re-granting SELECT to a role that already has it is a no-op, and a role that does not exist
 * in this environment is skipped with a notice rather than failing the migration.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(TRADES_MV_READER_GRANT_SQL)
}

/**
 * No down migration. Revoking read access from the warehouse is not a state worth being able to return
 * to, and it is the exact breakage this migration exists to repair.
 */
export async function down(): Promise<void> {
  return
}
