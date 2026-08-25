/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'
import {
  CREATE_SEARCH_WORDS_TABLE,
  CREATE_SEARCH_WORDS_WORD_INDEX,
  DROP_SEARCH_WORDS_TABLE,
  SEARCH_WORDS_WORD_INDEX
} from '../../logic/catalog/search-words-table'

// The catalog search used to explode every item name into words on the fly, with a LATERAL unnest over
// the whole item table. That can't use an index, so every search scanned the entire catalog. This table
// holds the same (item, word) pairs so the trigram filter becomes an index lookup.
//
// Populating it here means search is fast from the first request after deploy; from then on the catalog
// job rebuilds it every few minutes. Note that `down` is therefore not a lasting inverse — the running
// job recreates the table on its next cycle. Rolling this back means deploying code that no longer
// rebuilds it.
export async function up(pgm: MigrationBuilder): Promise<void> {
  // Pinned to `public` so the operator class the index below names is where it is expected to be. This
  // is a no-op wherever the extension already exists, which is every environment we deploy to.
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;')
  pgm.sql(`${CREATE_SEARCH_WORDS_TABLE};`)
  pgm.sql(`${CREATE_SEARCH_WORDS_WORD_INDEX};`)

  // Tag lookups filter on lower(tag) over ~200k rows, which was a sequential scan on every search.
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_mv_builder_server_items_lower_tag
      ON marketplace.mv_builder_server_items (lower(tag));`
  )
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP INDEX IF EXISTS marketplace.idx_mv_builder_server_items_lower_tag;')
  pgm.sql(`DROP INDEX IF EXISTS marketplace.${SEARCH_WORDS_WORD_INDEX};`)
  pgm.sql(`${DROP_SEARCH_WORDS_TABLE};`)
}
