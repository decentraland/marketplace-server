/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'

// The catalog search used to explode every item name into words on the fly, with a LATERAL unnest over
// the whole item table. That can't use an index, so every search scanned the entire catalog. This table
// holds the same (item, word) pairs so the trigram filter becomes an index lookup.
//
// Populating it here means search is fast from the first request after deploy; from then on the catalog
// job rebuilds it every few minutes. Note that `down` is therefore not a lasting inverse — the running
// job recreates the table on its next cycle. Rolling this back means deploying code that no longer
// rebuilds it.
//
// The SQL is inlined rather than imported: a later migration reshapes the table and its builder, and a
// migration has to keep producing what it produced on the day it ran, whatever the live code does now.
const SELECT_SEARCH_WORDS_V1 = `SELECT
      items.id::text AS item_id,
      lower(w.text) AS word,
      w.text AS original_word
    FROM squid_marketplace.item AS items
    JOIN squid_marketplace.metadata AS md
      ON md.id = items.metadata_id
    LEFT JOIN squid_marketplace.wearable AS wb
      ON wb.id = md.wearable_id
     AND md.item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1')
    LEFT JOIN squid_marketplace.emote AS em
      ON em.id = md.emote_id
     AND md.item_type = 'emote_v1'
    CROSS JOIN LATERAL unnest(string_to_array(COALESCE(wb.name, em.name), ' ')) AS w(text)
    WHERE w.text <> ''
    UNION
    SELECT
      items.id::text AS item_id,
      lower(w.text) AS word,
      w.text AS original_word
    FROM squid_marketplace.item AS items
    JOIN squid_marketplace.collection AS collections
      ON collections.id = items.collection_id
    CROSS JOIN LATERAL unnest(string_to_array(collections.name, ' ')) AS w(text)
    WHERE w.text <> ''`

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Pinned to `public` so the operator class the index below names is where it is expected to be. This
  // is a no-op wherever the extension already exists, which is every environment we deploy to.
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;')
  pgm.sql(`CREATE TABLE IF NOT EXISTS marketplace.item_search_words AS ${SELECT_SEARCH_WORDS_V1};`)
  pgm.sql(
    'CREATE INDEX IF NOT EXISTS idx_item_search_words_word_trgm ON marketplace.item_search_words USING gin (word public.gin_trgm_ops);'
  )

  // Tag lookups filter on lower(tag) over ~200k rows, which was a sequential scan on every search.
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_mv_builder_server_items_lower_tag
      ON marketplace.mv_builder_server_items (lower(tag));`
  )
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP INDEX IF EXISTS marketplace.idx_mv_builder_server_items_lower_tag;')
  pgm.sql('DROP INDEX IF EXISTS marketplace.idx_item_search_words_word_trgm;')
  pgm.sql('DROP TABLE IF EXISTS marketplace.item_search_words;')
}
