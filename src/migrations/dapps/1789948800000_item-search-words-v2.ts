/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'

// The search words table, reshaped, under a NEW name (`item_search_words_v2`): words are normalized
// (lowercased, unaccented, split on punctuation) through SQL functions the query side shares, each carries
// which name it came from (the item's or its collection's), and a hyphenated or multi-word name also
// yields its collapsed forms ("T-Shirt" → t, shirt, tshirt; "Golf Craft" → golfcraft). A second table
// holds each item's normalized name for the exact-name bonus of the ranking.
//
// The previous table, `item_search_words`, is left exactly as it is. Instances of the previous release
// keep reading and rebuilding it while the roll-out lasts, and `down` restores nothing because it removes
// nothing they use: rolling back is dropping the new objects, and the old code is whole again. The old
// table is dropped by a later migration, once no instance of the previous release can still be running.
//
// Both tables are built here so the new shape serves from the first request after deploy; the catalog
// job then rebuilds them every few minutes, so `down` is not a lasting inverse of THEIR contents either.
//
// The SQL is a COPY of what the code built at the time, not an import of it. The live word query has since
// grown a join to a table a later migration creates, and a migration that imported it would fail on any
// database migrating from scratch. A migration is a record of what ran, so it has to stay what ran.
//
// `unaccent` is a trusted extension: creating it needs CREATE on the database, which the role that runs
// these migrations has (it owns the previous table).

const CREATE_SEARCH_NORMALIZATION_FUNCTIONS = [
  `CREATE OR REPLACE FUNCTION marketplace.search_tokens(input text) RETURNS text[]
  LANGUAGE sql STABLE PARALLEL SAFE AS $fn$
    SELECT COALESCE(pg_catalog.array_agg(t.token ORDER BY t.ordinality), '{}'::text[])
    FROM (
      SELECT
        pg_catalog.regexp_replace(public.unaccent('public.unaccent'::regdictionary, parts.part), '[^[:alnum:]]', '', 'g') AS token,
        parts.ordinality
      FROM pg_catalog.regexp_split_to_table(pg_catalog.lower(normalize(COALESCE(input, ''), NFC)), '[^[:alnum:]]+')
        WITH ORDINALITY AS parts(part, ordinality)
    ) t
    WHERE t.token <> ''
  $fn$`,
  `CREATE OR REPLACE FUNCTION marketplace.search_phrase(input text) RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE AS $fn$
    SELECT pg_catalog.array_to_string(marketplace.search_tokens(input), ' ')
  $fn$`,
  `CREATE OR REPLACE FUNCTION marketplace.search_query_terms(input text) RETURNS text[]
  LANGUAGE sql STABLE PARALLEL SAFE AS $fn$
    WITH words AS (
      SELECT
        pg_catalog.array_to_string(marketplace.search_tokens(w.word), '') AS term,
        w.ordinality
      FROM pg_catalog.regexp_split_to_table(COALESCE(input, ''), '\\s+') WITH ORDINALITY AS w(word, ordinality)
    ), tokens AS (
      SELECT term, MIN(ordinality) AS ordinality
      FROM words
      WHERE term <> ''
      GROUP BY term
    ), kept AS (
      SELECT term, ordinality FROM tokens
      WHERE term <> ALL ('{the,a,an,of,and,x,de,la,el,los,las,y}'::text[])
    )
    SELECT COALESCE(pg_catalog.array_agg(l.term ORDER BY l.ordinality), '{}'::text[])
    FROM (
      SELECT term, ordinality FROM kept
      UNION ALL
      SELECT term, ordinality FROM tokens WHERE NOT EXISTS (SELECT 1 FROM kept)
      ORDER BY ordinality
      LIMIT 6
    ) l
  $fn$`
]

const DROP_SEARCH_NORMALIZATION_FUNCTIONS = [
  'DROP FUNCTION IF EXISTS marketplace.search_query_terms(text)',
  'DROP FUNCTION IF EXISTS marketplace.search_phrase(text)',
  'DROP FUNCTION IF EXISTS marketplace.search_tokens(text)'
]

const DROP_SEARCH_WORDS_TABLE = 'DROP TABLE IF EXISTS marketplace.item_search_words_v2'
const CREATE_SEARCH_WORDS_TABLE = `CREATE TABLE IF NOT EXISTS marketplace.item_search_words_v2 AS WITH named AS (
      SELECT items.id::text AS item_id, COALESCE(wb.name, em.name) AS name, 'name' AS source
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
      SELECT items.id::text AS item_id, collections.name AS name, 'collection' AS source
      FROM squid_marketplace.item AS items
      JOIN squid_marketplace.collection AS collections
        ON collections.id = items.collection_id
    ), words AS (
      SELECT n.item_id, n.source, w.word, w.position
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
       AND b.position = a.position + 1
    )
    SELECT item_id, word, source, min(original_word) AS original_word
    FROM tokens
    WHERE word <> ''
    GROUP BY item_id, word, source`
const CREATE_SEARCH_WORDS_WORD_INDEX =
  'CREATE INDEX IF NOT EXISTS idx_item_search_words_v2_word_trgm ON marketplace.item_search_words_v2 USING gin (word public.gin_trgm_ops)'
const CREATE_SEARCH_WORDS_ITEM_INDEX =
  'CREATE INDEX IF NOT EXISTS idx_item_search_words_v2_item_id ON marketplace.item_search_words_v2 (item_id)'
const DROP_SEARCH_NAMES_TABLE = 'DROP TABLE IF EXISTS marketplace.item_search_names'
const CREATE_SEARCH_NAMES_TABLE = `CREATE TABLE IF NOT EXISTS marketplace.item_search_names AS SELECT
      items.id::text AS item_id,
      marketplace.search_phrase(COALESCE(wb.name, em.name)) AS phrase,
      (SELECT string_agg(word, ' ' ORDER BY word) FROM unnest(marketplace.search_tokens(COALESCE(wb.name, em.name))) AS word) AS sorted_words
    FROM squid_marketplace.item AS items
    JOIN squid_marketplace.metadata AS md
      ON md.id = items.metadata_id
    LEFT JOIN squid_marketplace.wearable AS wb
      ON wb.id = md.wearable_id
     AND md.item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1')
    LEFT JOIN squid_marketplace.emote AS em
      ON em.id = md.emote_id
     AND md.item_type = 'emote_v1'`
const CREATE_SEARCH_NAMES_ITEM_INDEX = 'CREATE INDEX IF NOT EXISTS idx_item_search_names_item_id ON marketplace.item_search_names (item_id)'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;')
  for (const statement of CREATE_SEARCH_NORMALIZATION_FUNCTIONS) pgm.sql(`${statement};`)
  pgm.sql(`${DROP_SEARCH_WORDS_TABLE};`)
  pgm.sql(`${CREATE_SEARCH_WORDS_TABLE};`)
  pgm.sql(`${CREATE_SEARCH_WORDS_WORD_INDEX};`)
  pgm.sql(`${CREATE_SEARCH_WORDS_ITEM_INDEX};`)
  pgm.sql(`${DROP_SEARCH_NAMES_TABLE};`)
  pgm.sql(`${CREATE_SEARCH_NAMES_TABLE};`)
  pgm.sql(`${CREATE_SEARCH_NAMES_ITEM_INDEX};`)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`${DROP_SEARCH_NAMES_TABLE};`)
  pgm.sql(`${DROP_SEARCH_WORDS_TABLE};`)
  for (const statement of DROP_SEARCH_NORMALIZATION_FUNCTIONS) pgm.sql(`${statement};`)
}
