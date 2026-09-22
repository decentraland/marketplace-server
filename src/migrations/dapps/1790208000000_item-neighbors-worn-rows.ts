/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'
import { NEIGHBORS_META_TABLE } from '../../logic/suggestions/constants'

// Rows the co-wear source wrote in the last rebuild, next to the other two sources' counts.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE ${NEIGHBORS_META_TABLE} ADD COLUMN IF NOT EXISTS worn_rows integer NOT NULL DEFAULT 0;`)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE ${NEIGHBORS_META_TABLE} DROP COLUMN IF EXISTS worn_rows;`)
}
