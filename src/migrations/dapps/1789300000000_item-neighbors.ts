/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'
import {
  CREATE_NEIGHBORS_ITEM_INDEX,
  CREATE_NEIGHBORS_META_TABLE,
  CREATE_NEIGHBORS_TABLE,
  DROP_NEIGHBORS_META_TABLE,
  DROP_NEIGHBORS_TABLE
} from '../../logic/suggestions/neighbors-table'

// Precomputed item-item neighbours behind /v3/catalog/suggested: one row per (anchor, source,
// neighbour), where source is the co-ownership generator or the content one. Recomputed in full every
// few hours and swapped in, so the table is a cache with a known shape rather than something to
// maintain incrementally.
//
// Created empty. The endpoint answers with the trending fallback until the first rebuild populates it,
// which is the same behaviour it has for a wallet with no signal — so deploying this ahead of the job
// is safe. `down` is not a lasting inverse once the job ships: it recreates the table on its next run.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`${CREATE_NEIGHBORS_TABLE};`)
  pgm.sql(`${CREATE_NEIGHBORS_ITEM_INDEX};`)
  pgm.sql(`${CREATE_NEIGHBORS_META_TABLE};`)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`${DROP_NEIGHBORS_META_TABLE};`)
  pgm.sql(`${DROP_NEIGHBORS_TABLE};`)
}
