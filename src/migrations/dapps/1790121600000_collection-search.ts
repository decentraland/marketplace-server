/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'

// Collections as the search suggestions know them: their names' searchable words, keyed by collection,
// and each name's normalized shapes with the two numbers ties are broken on (sales in the window, approved
// items). Both are rebuilt every few minutes by the job that rebuilds the other search tables; the
// migration only makes them empty, with their columns spelled out so the first rebuild's staging tables —
// CREATE TABLE AS — land on the same shape. Until that first rebuild, the suggestions offer no collection.
//
// `down` drops both. Run it only once no instance of this release is up: the rebuild of a running one
// would fail on the missing tables every five minutes (harmlessly — it keeps the previous ones — but
// loudly) until it stops.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`CREATE TABLE IF NOT EXISTS marketplace.collection_search_words (
    collection_id text,
    word text,
    source text,
    original_word text
  );`)
  pgm.sql(
    'CREATE INDEX IF NOT EXISTS idx_collection_search_words_word_trgm ON marketplace.collection_search_words USING gin (word public.gin_trgm_ops);'
  )
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_collection_search_words_collection_id ON marketplace.collection_search_words (collection_id);')
  pgm.sql(`CREATE TABLE IF NOT EXISTS marketplace.collection_search_names (
    collection_id text,
    phrase text,
    sorted_words text,
    items integer,
    sales integer
  );`)
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_collection_search_names_collection_id ON marketplace.collection_search_names (collection_id);')
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP TABLE IF EXISTS marketplace.collection_search_names;')
  pgm.sql('DROP TABLE IF EXISTS marketplace.collection_search_words;')
}
