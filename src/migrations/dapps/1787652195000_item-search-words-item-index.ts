/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'
import { CREATE_SEARCH_WORDS_ITEM_INDEX, SEARCH_WORDS_ITEM_INDEX } from '../../logic/catalog/search-words-table'

// The shop feeds now ask "does THIS item match the search term?" once per row, which needs to reach an
// item's few words directly — the trigram index answers the opposite question. The rebuild job creates
// this index on every swap, but that first runs minutes after deploy, and the search sits on the hot
// path until then.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`${CREATE_SEARCH_WORDS_ITEM_INDEX};`)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP INDEX IF EXISTS marketplace.${SEARCH_WORDS_ITEM_INDEX};`)
}
