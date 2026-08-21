/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'
import { TRADES_MV_CREATE_SQL, TRADES_MV_INDEX_SQLS, TRADES_MV_NAME } from '../../logic/trades/materialized-view'

/**
 * Brings mv_trades up to the current definition.
 *
 * Migration 1739898312357 created the view and was then never updated, while every later change went
 * into recreateTradesMaterializedView(). A database that was only ever migrated therefore computed trade
 * status with the original rules — no V3 cancellation digest, contract signature index matched by network
 * across every marketplace address, signer index unscoped — until an operator happened to call
 * POST /v1/trades/materialized-view/recreate.
 *
 * Deliberately applies the SAME exported constants that endpoint applies rather than a copy of the SQL,
 * so the two cannot drift again. That does mean this migration is not frozen: replaying it after a future
 * change to the view yields that newer definition. For a derived object that is the behaviour we want —
 * "make the view current" — and it is idempotent, since the view holds no state of its own.
 *
 * Only the view and its indexes. The refresh function, the gate table and the source-table triggers are
 * created by the earlier migration and are unchanged, and CASCADE does not reach them: the triggers sit on
 * marketplace.trades / the squid tables and reach the view through a function body, which Postgres does
 * not dependency-track.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP MATERIALIZED VIEW IF EXISTS marketplace.${TRADES_MV_NAME} CASCADE`)
  pgm.sql(TRADES_MV_CREATE_SQL)

  for (const indexSql of TRADES_MV_INDEX_SQLS) {
    pgm.sql(indexSql)
  }

  // The refresh runs as this role and REFRESH requires ownership.
  pgm.sql(`ALTER MATERIALIZED VIEW marketplace.${TRADES_MV_NAME} OWNER TO mv_trades_owner`)
}

/**
 * No down migration. Reverting would mean recreating the superseded definition, which is exactly the
 * stale view this migration exists to replace; dropping the view instead would break every reader.
 */
export async function down(): Promise<void> {
  return
}
