/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'

// Creators as the search knows them: one row per creator of an approved collection, with the profile
// name and avatar Catalyst gives them, the NAMEs they hold and how much they have published. A job fills
// and refreshes it; the migration only makes the empty table, so the deploy does not depend on Catalyst.
//
// The second table holds the searchable words of those names, keyed by creator, for the creator
// suggestions. It is rebuilt every few minutes by the same job that rebuilds the item words, which is
// also where the creator names reach the item words. Its columns are spelled out here so the very first
// rebuild's staging table — a CREATE TABLE AS — lands on the same shape.
//
// The item words move to a NEW name, `item_search_words_v3`, because their content changes (they gain
// the creator's names as a third source): under the previous name, this release and the previous one
// would overwrite each other's words every five minutes for as long as a roll-out or a rollback lasts.
// `item_search_words_v2` is left exactly as it is for the previous release, to be dropped by a later
// migration together with v1. The v3 table is built here so the new readers have it from the first request
// after deploy — with no creator words yet, since the profiles table is empty until the job runs — from a
// COPY of the query the code built at the time, never an import of it: a migration is a record of what ran.
//
// `down` drops the three. Run it only once no instance of this release is up: the rebuild of a running one
// would fail on the missing tables every five minutes (harmlessly — it keeps the previous ones — but
// loudly) until it stops.

const SELECT_SEARCH_WORDS_V3 = `WITH named AS (
      SELECT items.id::text AS item_id, 1 AS entry, COALESCE(wb.name, em.name) AS name, 'name' AS source
      FROM squid_marketplace.item AS items
      JOIN squid_marketplace.metadata AS md
        ON md.id = items.metadata_id
      LEFT JOIN squid_marketplace.wearable AS wb
        ON wb.id = md.wearable_id
       AND md.item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1')
      LEFT JOIN squid_marketplace.emote AS em
        ON em.id = md.emote_id
       AND md.item_type = 'emote_v1'
      UNION ALL
      SELECT items.id::text AS item_id, 1 AS entry, collections.name AS name, 'collection' AS source
      FROM squid_marketplace.item AS items
      JOIN squid_marketplace.collection AS collections
        ON collections.id = items.collection_id
      UNION ALL
      SELECT items.id::text AS item_id, n.entry::int AS entry, n.name, 'creator' AS source
      FROM squid_marketplace.item AS items
      JOIN marketplace.creator_profiles AS cp
        ON cp.address = items.creator
      CROSS JOIN LATERAL unnest(array_prepend(cp.name, cp.names[1:10])) WITH ORDINALITY AS n(name, entry)
      WHERE n.name IS NOT NULL
    ), words AS (
      SELECT n.item_id, n.entry, n.source, w.word, w.position
      FROM named AS n
      CROSS JOIN LATERAL regexp_split_to_table(COALESCE(n.name, ''), '\\s+') WITH ORDINALITY AS w(word, position)
      WHERE w.word <> ''
    ), tokens AS (
      SELECT w.item_id, w.source, t.token AS word, w.word AS original_word
      FROM words AS w
      CROSS JOIN LATERAL unnest(marketplace.search_tokens(w.word)) AS t(token)
      UNION ALL
      SELECT w.item_id, w.source, replace(marketplace.search_phrase(w.word), ' ', ''), w.word
      FROM words AS w
      UNION ALL
      SELECT a.item_id, a.source, replace(marketplace.search_phrase(a.word || ' ' || b.word), ' ', ''), a.word || ' ' || b.word
      FROM words AS a
      JOIN words AS b
        ON b.item_id = a.item_id
       AND b.source = a.source
       AND b.entry = a.entry
       AND b.position = a.position + 1
    )
    SELECT item_id, word, source, min(original_word) AS original_word
    FROM tokens
    WHERE word <> ''
    GROUP BY item_id, word, source`
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`CREATE TABLE IF NOT EXISTS marketplace.creator_profiles (
    address text PRIMARY KEY,
    name text,
    has_claimed_name boolean NOT NULL DEFAULT false,
    face text,
    names text[] NOT NULL DEFAULT '{}'::text[],
    items integer NOT NULL DEFAULT 0,
    collections integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
  );`)
  pgm.sql(`CREATE TABLE IF NOT EXISTS marketplace.creator_search_words (
    address text,
    word text,
    source text,
    original_word text
  );`)
  pgm.sql(
    'CREATE INDEX IF NOT EXISTS idx_creator_search_words_word_trgm ON marketplace.creator_search_words USING gin (word public.gin_trgm_ops);'
  )
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_creator_search_words_address ON marketplace.creator_search_words (address);')
  pgm.sql('DROP TABLE IF EXISTS marketplace.item_search_words_v3;')
  pgm.sql(`CREATE TABLE marketplace.item_search_words_v3 AS ${SELECT_SEARCH_WORDS_V3};`)
  pgm.sql('CREATE INDEX idx_item_search_words_v3_word_trgm ON marketplace.item_search_words_v3 USING gin (word public.gin_trgm_ops);')
  pgm.sql('CREATE INDEX idx_item_search_words_v3_item_id ON marketplace.item_search_words_v3 (item_id);')
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP TABLE IF EXISTS marketplace.item_search_words_v3;')
  pgm.sql('DROP TABLE IF EXISTS marketplace.creator_search_words;')
  pgm.sql('DROP TABLE IF EXISTS marketplace.creator_profiles;')
}
