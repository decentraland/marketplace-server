/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'

// The shop feeds now ask "does THIS item match the search term?" once per row, which needs to reach an
// item's few words directly — the trigram index answers the opposite question. The rebuild job creates
// this index on every swap, but that first runs minutes after deploy, and the search sits on the hot
// path until then.
//
// Inlined rather than imported: the live code has since moved on to a versioned table, and a migration has
// to keep producing what it produced on the day it ran.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_item_search_words_item_id ON marketplace.item_search_words (item_id);')
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP INDEX IF EXISTS marketplace.idx_item_search_words_item_id;')
}
