/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'
import { TRADES_MV_CREATE_SQL, TRADES_MV_INDEX_SQLS, TRADES_MV_NAME } from '../../logic/trades/materialized-view'

/**
 * Brings mv_trades up to the current definition, which now projects the trade's `chain_id`.
 *
 * The view grouped by it but never selected it, so readers could only reach a listing's chain through its
 * network — and `network` does not identify a chain, since Polygon mainnet and Amoy are both MATIC and
 * addTrade stores whatever chain a trade's signature verifies against. The shop catalogue's coupon join
 * needs the real value to keep a creator's discount on the chain it was signed for.
 *
 * Applies the same exported constants as the recreate endpoint and migration 1787300000000, for the reason
 * given there: the definition lives in one place so the two paths cannot drift.
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
 * No down migration, as in 1787300000000: reverting would recreate a definition this exists to replace, and
 * dropping the view instead would break every reader.
 */
export async function down(): Promise<void> {
  return
}
