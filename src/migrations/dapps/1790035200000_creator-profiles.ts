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
// `down` drops both. Run it only once no instance of this release is up: the rebuild of a running one
// would fail on the missing table every five minutes (harmlessly — it keeps the previous tables — but
// loudly) until it stops.
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
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP TABLE IF EXISTS marketplace.creator_search_words;')
  pgm.sql('DROP TABLE IF EXISTS marketplace.creator_profiles;')
}
