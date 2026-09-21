import { BUILDER_SERVER_TABLE_SCHEMA, MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { SEARCH_PHRASE_FUNCTION, SEARCH_TOKENS_FUNCTION } from './search-normalization'

/**
 * VERSIONED on purpose. A release is rolled out instance by instance, and the previous release keeps
 * rebuilding ITS word table every five minutes until its last instance stops. Had this shape kept the
 * old name, an old instance rebuilding after the migration would have swapped a table without `source`
 * back in under the new readers, which fail on the missing column until the next new rebuild. Under its
 * own name, each release rebuilds and reads its own table; the previous one is dropped by a later
 * migration, once no instance reads it any more.
 */
export const SEARCH_WORDS_TABLE_NAME = 'item_search_words_v2'
export const SEARCH_WORDS_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${SEARCH_WORDS_TABLE_NAME}`
export const SEARCH_WORDS_WORD_INDEX = `idx_${SEARCH_WORDS_TABLE_NAME}_word_trgm`
export const SEARCH_WORDS_ITEM_INDEX = `idx_${SEARCH_WORDS_TABLE_NAME}_item_id`

export const SEARCH_NAMES_TABLE_NAME = 'item_search_names'
export const SEARCH_NAMES_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${SEARCH_NAMES_TABLE_NAME}`
export const SEARCH_NAMES_ITEM_INDEX = `idx_${SEARCH_NAMES_TABLE_NAME}_item_id`

const STAGING_TABLE_NAME = `${SEARCH_WORDS_TABLE_NAME}_staging`
const STAGING_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${STAGING_TABLE_NAME}`
const STAGING_WORD_INDEX = `${SEARCH_WORDS_WORD_INDEX}_staging`
const STAGING_ITEM_INDEX = `${SEARCH_WORDS_ITEM_INDEX}_staging`
const NAMES_STAGING_TABLE_NAME = `${SEARCH_NAMES_TABLE_NAME}_staging`
const NAMES_STAGING_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${NAMES_STAGING_TABLE_NAME}`
const NAMES_STAGING_ITEM_INDEX = `${SEARCH_NAMES_ITEM_INDEX}_staging`

// Any positive constant works; it only has to be the same in every instance of this service.
const REBUILD_ADVISORY_LOCK_KEY = 8_421_207

// pg_trgm is installed in `public`, but migrations run with search_path set to the marketplace schema
// alone, so an unqualified operator class does not resolve there. Naming the schema keeps this index
// buildable from both the migration and the rebuild job, whatever their search_path happens to be.
const TRIGRAM_OPS = 'public.gin_trgm_ops'

/**
 * One row per (item, searchable word, source). `word` is normalized by `search_tokens` — lowercased,
 * unaccented, punctuation-free — and carries the trigram index used for matching; `original_word` keeps
 * the source's own spelling, because it is reported back as the matched term in search analytics;
 * `source` says whether the word comes from the item's own name or from its collection's, so the match
 * can weigh the two differently.
 *
 * Two sources feed it. The item's own name, obviously — and the name of the collection it belongs to,
 * because that is where brand and collaboration names live. Searching "balenciaga" used to return
 * nothing at all: no item is named that, and no tag carries it, but three collections are. Same for
 * "mvfw", which names a Metaverse Fashion Week collection rather than any garment in it.
 *
 * Each whitespace-separated word yields three kinds of rows: its normalized parts ("T-Shirt" → t, shirt),
 * the word collapsed into one token (tshirt), and, for adjacent words, the pair collapsed ("Golf Craft"
 * → golfcraft). The collapsed forms are what let "tshirt", "t-shirt" and "t shirt" find the same items,
 * and "golfcraft" find a collection spelled as two words — a query people actually typed and got one
 * result for.
 *
 * This is a plain table rather than a materialized view on purpose. A materialized view resolves its
 * source tables once and holds them by oid, and squid deployments are promoted by renaming a
 * timestamped schema onto `squid_marketplace` — which leaves oids untouched. A view would keep
 * serving the retired deployment's names with nothing to signal it, and it would also make the
 * retired schema undroppable. Rebuilding a table from a plain query has neither problem.
 */
const SELECT_SEARCH_WORDS = `WITH named AS (
      SELECT items.id::text AS item_id, COALESCE(wb.name, em.name) AS name, 'name' AS source
      FROM ${MARKETPLACE_SQUID_SCHEMA}.item AS items
      JOIN ${MARKETPLACE_SQUID_SCHEMA}.metadata AS md
        ON md.id = items.metadata_id
      LEFT JOIN ${MARKETPLACE_SQUID_SCHEMA}.wearable AS wb
        ON wb.id = md.wearable_id
       AND md.item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1')
      LEFT JOIN ${MARKETPLACE_SQUID_SCHEMA}.emote AS em
        ON em.id = md.emote_id
       AND md.item_type = 'emote_v1'
      UNION ALL
      SELECT items.id::text AS item_id, collections.name AS name, 'collection' AS source
      FROM ${MARKETPLACE_SQUID_SCHEMA}.item AS items
      JOIN ${MARKETPLACE_SQUID_SCHEMA}.collection AS collections
        ON collections.id = items.collection_id
    ), words AS (
      SELECT n.item_id, n.source, w.word, w.position
      FROM named AS n
      CROSS JOIN LATERAL regexp_split_to_table(COALESCE(n.name, ''), '\\s+') WITH ORDINALITY AS w(word, position)
      WHERE w.word <> ''
    ), tokens AS (
      SELECT w.item_id, w.source, t.token AS word, w.word AS original_word
      FROM words AS w
      CROSS JOIN LATERAL unnest(${SEARCH_TOKENS_FUNCTION}(w.word)) AS t(token)
      UNION ALL
      SELECT w.item_id, w.source, replace(${SEARCH_PHRASE_FUNCTION}(w.word), ' ', ''), w.word
      FROM words AS w
      UNION ALL
      SELECT a.item_id, a.source, replace(${SEARCH_PHRASE_FUNCTION}(a.word || ' ' || b.word), ' ', ''), a.word || ' ' || b.word
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

export const CREATE_SEARCH_WORDS_TABLE = `CREATE TABLE IF NOT EXISTS ${SEARCH_WORDS_TABLE} AS ${SELECT_SEARCH_WORDS}`
export const CREATE_SEARCH_WORDS_WORD_INDEX = `CREATE INDEX IF NOT EXISTS ${SEARCH_WORDS_WORD_INDEX} ON ${SEARCH_WORDS_TABLE} USING gin (word ${TRIGRAM_OPS})`
// The shop feeds ask "does THIS item match?" once per row, so they need to reach an item's handful of
// words directly. The trigram index answers the opposite question and cannot serve that lookup.
export const CREATE_SEARCH_WORDS_ITEM_INDEX = `CREATE INDEX IF NOT EXISTS ${SEARCH_WORDS_ITEM_INDEX} ON ${SEARCH_WORDS_TABLE} (item_id)`
export const DROP_SEARCH_WORDS_TABLE = `DROP TABLE IF EXISTS ${SEARCH_WORDS_TABLE}`

/**
 * One row per item with its name in the two shapes the ranking compares a query against: the normalized
 * phrase, and the same words sorted. Precomputed here rather than derived from the name on every searching
 * row: the feeds would otherwise normalize each candidate's name three times per request, which on a
 * two-letter query is a few thousand regexp-and-unaccent calls and was most of the search's cost.
 */
const SELECT_SEARCH_NAMES = `SELECT
      items.id::text AS item_id,
      ${SEARCH_PHRASE_FUNCTION}(COALESCE(wb.name, em.name)) AS phrase,
      (SELECT string_agg(word, ' ' ORDER BY word) FROM unnest(${SEARCH_TOKENS_FUNCTION}(COALESCE(wb.name, em.name))) AS word) AS sorted_words
    FROM ${MARKETPLACE_SQUID_SCHEMA}.item AS items
    JOIN ${MARKETPLACE_SQUID_SCHEMA}.metadata AS md
      ON md.id = items.metadata_id
    LEFT JOIN ${MARKETPLACE_SQUID_SCHEMA}.wearable AS wb
      ON wb.id = md.wearable_id
     AND md.item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1')
    LEFT JOIN ${MARKETPLACE_SQUID_SCHEMA}.emote AS em
      ON em.id = md.emote_id
     AND md.item_type = 'emote_v1'`

export const CREATE_SEARCH_NAMES_TABLE = `CREATE TABLE IF NOT EXISTS ${SEARCH_NAMES_TABLE} AS ${SELECT_SEARCH_NAMES}`
export const CREATE_SEARCH_NAMES_ITEM_INDEX = `CREATE INDEX IF NOT EXISTS ${SEARCH_NAMES_ITEM_INDEX} ON ${SEARCH_NAMES_TABLE} (item_id)`
export const DROP_SEARCH_NAMES_TABLE = `DROP TABLE IF EXISTS ${SEARCH_NAMES_TABLE}`

export type RebuildOutcome = 'rebuilt' | 'skipped'

type QueryableClient = { query: (sql: string) => Promise<{ rows: { acquired?: boolean }[] }> }

/**
 * Rebuilds the two search tables from scratch and swaps them in.
 *
 * Everything happens in one transaction, and the live tables are only touched by the drop-and-rename at
 * the very end. So a failure part way through — including hitting the pool's statement timeout — rolls
 * back and leaves the current table serving queries, to be retried on the next cycle. Readers block
 * only for the final rename, not for the build.
 *
 * A full rebuild costs well under a second at current catalog size, which is why there is no attempt to
 * compute a delta: doing the whole thing is both cheaper to reason about and correct after a squid
 * promotion without any special casing.
 */
export async function rebuildItemSearchWords(client: QueryableClient): Promise<RebuildOutcome> {
  await client.query('BEGIN')
  try {
    // Several instances run this job on the same schedule. The lock is released with the transaction.
    const { rows } = await client.query(`SELECT pg_try_advisory_xact_lock(${REBUILD_ADVISORY_LOCK_KEY}) AS acquired`)
    if (!rows[0]?.acquired) {
      await client.query('ROLLBACK')
      return 'skipped'
    }

    await client.query(`DROP TABLE IF EXISTS ${STAGING_TABLE}`)
    await client.query(`CREATE TABLE ${STAGING_TABLE} AS ${SELECT_SEARCH_WORDS}`)
    await client.query(`CREATE INDEX ${STAGING_WORD_INDEX} ON ${STAGING_TABLE} USING gin (word ${TRIGRAM_OPS})`)
    await client.query(`CREATE INDEX ${STAGING_ITEM_INDEX} ON ${STAGING_TABLE} (item_id)`)
    await client.query(`ANALYZE ${STAGING_TABLE}`)
    await client.query(`DROP TABLE IF EXISTS ${NAMES_STAGING_TABLE}`)
    await client.query(`CREATE TABLE ${NAMES_STAGING_TABLE} AS ${SELECT_SEARCH_NAMES}`)
    await client.query(`CREATE INDEX ${NAMES_STAGING_ITEM_INDEX} ON ${NAMES_STAGING_TABLE} (item_id)`)
    await client.query(`ANALYZE ${NAMES_STAGING_TABLE}`)

    await client.query(DROP_SEARCH_WORDS_TABLE)
    await client.query(`ALTER TABLE ${STAGING_TABLE} RENAME TO ${SEARCH_WORDS_TABLE_NAME}`)
    await client.query(`ALTER INDEX ${BUILDER_SERVER_TABLE_SCHEMA}.${STAGING_WORD_INDEX} RENAME TO ${SEARCH_WORDS_WORD_INDEX}`)
    await client.query(`ALTER INDEX ${BUILDER_SERVER_TABLE_SCHEMA}.${STAGING_ITEM_INDEX} RENAME TO ${SEARCH_WORDS_ITEM_INDEX}`)
    await client.query(DROP_SEARCH_NAMES_TABLE)
    await client.query(`ALTER TABLE ${NAMES_STAGING_TABLE} RENAME TO ${SEARCH_NAMES_TABLE_NAME}`)
    await client.query(`ALTER INDEX ${BUILDER_SERVER_TABLE_SCHEMA}.${NAMES_STAGING_ITEM_INDEX} RENAME TO ${SEARCH_NAMES_ITEM_INDEX}`)

    await client.query('COMMIT')
    return 'rebuilt'
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  }
}
