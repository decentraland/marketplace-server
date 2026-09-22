/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'
import {
  TRADES_MV_CREATE_SQL,
  TRADES_MV_INDEX_SQLS,
  TRADES_MV_NAME,
  TRADES_MV_READERS_RESTORE_SQL,
  TRADES_MV_READERS_SNAPSHOT_SQL
} from '../../logic/trades/materialized-view'

/**
 * Brings mv_trades up to the current definition, which now projects the trade's `chain_id`.
 *
 * The view grouped by it but never selected it, so readers could only reach a listing's chain through its
 * network, and `network` does not identify a chain: Polygon mainnet and Amoy are both MATIC, and addTrade
 * stores whatever chain a trade's signature verifies against. The shop catalogue's coupon join needs the
 * real value to keep a creator's discount on the chain it was signed for.
 *
 * `DROP` + `CREATE` is not `REFRESH`: the new view carries no grants, so every reader that is not the owner
 * loses `SELECT` unless it is granted back. The readers are snapshotted before the drop and granted the view
 * again once it exists and has its owner, through the same statements recreateTradesMaterializedView uses.
 * Migration 1787300000000 rebuilt the view without that and the warehouse reader lost it in production, so
 * this one shares every statement with the function rather than a subset: the definition, the indexes and
 * the grants alike. The snapshot lives in a temp table dropped on commit, which needs this migration to run
 * inside one transaction, as node-pg-migrate does by default.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(TRADES_MV_READERS_SNAPSHOT_SQL)
  pgm.sql(`DROP MATERIALIZED VIEW IF EXISTS marketplace.${TRADES_MV_NAME} CASCADE`)
  pgm.sql(TRADES_MV_CREATE_SQL)

  for (const indexSql of TRADES_MV_INDEX_SQLS) {
    pgm.sql(indexSql)
  }

  // The refresh runs as this role and REFRESH requires ownership. Before the grants are replayed, as in the
  // function: membership of the new owner is what lets this session grant on the view afterwards.
  pgm.sql(`ALTER MATERIALIZED VIEW marketplace.${TRADES_MV_NAME} OWNER TO mv_trades_owner`)
  pgm.sql(TRADES_MV_READERS_RESTORE_SQL)
}

/**
 * No down migration, as in 1787300000000: reverting would recreate a definition this exists to replace, and
 * dropping the view instead would break every reader.
 */
export async function down(): Promise<void> {
  return
}
