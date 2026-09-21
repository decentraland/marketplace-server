import { BUILDER_SERVER_TABLE_SCHEMA, MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import {
  COLLECTION_SEARCH_NAMES_TABLE,
  COLLECTION_SEARCH_NAMES_TABLE_NAME,
  COLLECTION_SEARCH_WORDS_TABLE,
  COLLECTION_SEARCH_WORDS_TABLE_NAME,
  SELECT_COLLECTION_SEARCH_NAMES,
  SELECT_SEARCHABLE_COLLECTIONS
} from './collection-search'
import {
  CREATOR_MAX_NAMES,
  CREATOR_PROFILES_TABLE,
  CREATOR_SEARCH_NAMES_TABLE,
  CREATOR_SEARCH_NAMES_TABLE_NAME,
  CREATOR_SEARCH_WORDS_TABLE,
  CREATOR_SEARCH_WORDS_TABLE_NAME
} from './creator-profiles'
import { SEARCH_PHRASE_FUNCTION, SEARCH_TOKENS_FUNCTION } from './search-normalization'

/**
 * VERSIONED on purpose, and bumped by any release that changes what the table HOLDS, not only its shape.
 * A release is rolled out instance by instance, and the previous release keeps rebuilding ITS word table
 * every five minutes until its last instance stops. Under one name the two would take turns: a rebuild
 * by the previous release would drop the creator words this one added, and this release's words would
 * reach the previous release's readers, which weigh an unknown source like a collection's and match it
 * without the similarity gate — every five minutes, in both directions, for as long as a roll-out or a
 * rollback lasts. Under its own name, each release rebuilds and reads its own table; the previous ones
 * are dropped by a later migration, once no instance reads them any more.
 */
export const SEARCH_WORDS_TABLE_NAME = 'item_search_words_v3'
export const SEARCH_WORDS_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${SEARCH_WORDS_TABLE_NAME}`
export const SEARCH_WORDS_WORD_INDEX = `idx_${SEARCH_WORDS_TABLE_NAME}_word_trgm`
export const SEARCH_WORDS_ITEM_INDEX = `idx_${SEARCH_WORDS_TABLE_NAME}_item_id`

export const SEARCH_NAMES_TABLE_NAME = 'item_search_names'
export const SEARCH_NAMES_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${SEARCH_NAMES_TABLE_NAME}`
export const SEARCH_NAMES_ITEM_INDEX = `idx_${SEARCH_NAMES_TABLE_NAME}_item_id`

export const CREATOR_SEARCH_WORDS_WORD_INDEX = `idx_${CREATOR_SEARCH_WORDS_TABLE_NAME}_word_trgm`
export const CREATOR_SEARCH_WORDS_ADDRESS_INDEX = `idx_${CREATOR_SEARCH_WORDS_TABLE_NAME}_address`
export const CREATOR_SEARCH_NAMES_ADDRESS_INDEX = `idx_${CREATOR_SEARCH_NAMES_TABLE_NAME}_address`
export const COLLECTION_SEARCH_WORDS_WORD_INDEX = `idx_${COLLECTION_SEARCH_WORDS_TABLE_NAME}_word_trgm`
export const COLLECTION_SEARCH_WORDS_COLLECTION_INDEX = `idx_${COLLECTION_SEARCH_WORDS_TABLE_NAME}_collection_id`
export const COLLECTION_SEARCH_NAMES_COLLECTION_INDEX = `idx_${COLLECTION_SEARCH_NAMES_TABLE_NAME}_collection_id`

const STAGING_TABLE_NAME = `${SEARCH_WORDS_TABLE_NAME}_staging`
const STAGING_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${STAGING_TABLE_NAME}`
const STAGING_WORD_INDEX = `${SEARCH_WORDS_WORD_INDEX}_staging`
const STAGING_ITEM_INDEX = `${SEARCH_WORDS_ITEM_INDEX}_staging`
const NAMES_STAGING_TABLE_NAME = `${SEARCH_NAMES_TABLE_NAME}_staging`
const NAMES_STAGING_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${NAMES_STAGING_TABLE_NAME}`
const NAMES_STAGING_ITEM_INDEX = `${SEARCH_NAMES_ITEM_INDEX}_staging`
const CREATOR_STAGING_TABLE_NAME = `${CREATOR_SEARCH_WORDS_TABLE_NAME}_staging`
const CREATOR_STAGING_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${CREATOR_STAGING_TABLE_NAME}`
const CREATOR_STAGING_WORD_INDEX = `${CREATOR_SEARCH_WORDS_WORD_INDEX}_staging`
const CREATOR_STAGING_ADDRESS_INDEX = `${CREATOR_SEARCH_WORDS_ADDRESS_INDEX}_staging`
const CREATOR_NAMES_STAGING_TABLE_NAME = `${CREATOR_SEARCH_NAMES_TABLE_NAME}_staging`
const CREATOR_NAMES_STAGING_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${CREATOR_NAMES_STAGING_TABLE_NAME}`
const CREATOR_NAMES_STAGING_ADDRESS_INDEX = `${CREATOR_SEARCH_NAMES_ADDRESS_INDEX}_staging`
const COLLECTION_STAGING_TABLE_NAME = `${COLLECTION_SEARCH_WORDS_TABLE_NAME}_staging`
const COLLECTION_STAGING_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${COLLECTION_STAGING_TABLE_NAME}`
const COLLECTION_STAGING_WORD_INDEX = `${COLLECTION_SEARCH_WORDS_WORD_INDEX}_staging`
const COLLECTION_STAGING_COLLECTION_INDEX = `${COLLECTION_SEARCH_WORDS_COLLECTION_INDEX}_staging`
const COLLECTION_NAMES_STAGING_TABLE_NAME = `${COLLECTION_SEARCH_NAMES_TABLE_NAME}_staging`
const COLLECTION_NAMES_STAGING_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${COLLECTION_NAMES_STAGING_TABLE_NAME}`
const COLLECTION_NAMES_STAGING_COLLECTION_INDEX = `${COLLECTION_SEARCH_NAMES_COLLECTION_INDEX}_staging`

// Any positive constant works; it only has to be the same in every instance of this service.
const REBUILD_ADVISORY_LOCK_KEY = 8_421_207

// pg_trgm is installed in `public`, but migrations run with search_path set to the marketplace schema
// alone, so an unqualified operator class does not resolve there. Naming the schema keeps this index
// buildable from both the migration and the rebuild job, whatever their search_path happens to be.
const TRIGRAM_OPS = 'public.gin_trgm_ops'

/**
 * Turns `named` rows — one per (key, entry, name, source) — into one row per (key, word, source), where
 * `word` is normalized by `search_tokens` (lowercased, unaccented, punctuation-free) and carries the
 * trigram index used for matching, and `original_word` keeps the source's own spelling, because it is
 * reported back as the matched term in search analytics.
 *
 * Each whitespace-separated word yields three kinds of rows: its normalized parts ("T-Shirt" → t, shirt),
 * the word collapsed into one token (tshirt), and, for adjacent words, the pair collapsed ("Golf Craft"
 * → golfcraft). The collapsed forms are what let "tshirt", "t-shirt" and "t shirt" find the same items,
 * and "golfcraft" find a collection spelled as two words — a query people actually typed and got one
 * result for.
 *
 * `entry` tells apart several names under one key and source — a creator's profile name and each of
 * their NAMEs — so a pair is only ever two words of the SAME name.
 */
function selectWordsFrom(named: string, key: string): string {
  return `WITH named AS (
      ${named}
    ), words AS (
      SELECT n.${key}, n.entry, n.source, w.word, w.position
      FROM named AS n
      CROSS JOIN LATERAL regexp_split_to_table(COALESCE(n.name, ''), '\\s+') WITH ORDINALITY AS w(word, position)
      WHERE w.word <> ''
    ), tokens AS (
      SELECT w.${key}, w.source, t.token AS word, w.word AS original_word
      FROM words AS w
      CROSS JOIN LATERAL unnest(${SEARCH_TOKENS_FUNCTION}(w.word)) AS t(token)
      UNION ALL
      SELECT w.${key}, w.source, replace(${SEARCH_PHRASE_FUNCTION}(w.word), ' ', ''), w.word
      FROM words AS w
      UNION ALL
      SELECT a.${key}, a.source, replace(${SEARCH_PHRASE_FUNCTION}(a.word || ' ' || b.word), ' ', ''), a.word || ' ' || b.word
      FROM words AS a
      JOIN words AS b
        ON b.${key} = a.${key}
       AND b.source = a.source
       AND b.entry = a.entry
       AND b.position = a.position + 1
    )
    SELECT ${key}, word, source, min(original_word) AS original_word
    FROM tokens
    WHERE word <> ''
    GROUP BY ${key}, word, source`
}

/**
 * One row per (item, searchable word, source). `source` says which name the word comes from, so the match
 * can weigh them differently.
 *
 * Three sources feed it. The item's own name, obviously. The name of the collection it belongs to, because
 * that is where brand and collaboration names live: searching "balenciaga" used to return nothing at all —
 * no item is named that, and no tag carries it, but three collections are. And the names of its creator,
 * the profile name and their NAMEs, because that is what most of the searches that returned nothing were:
 * "metatiger", "dybo", "cubeman" — people looking for a creator's work by the creator's name.
 *
 * This is a plain table rather than a materialized view on purpose. A materialized view resolves its
 * source tables once and holds them by oid, and squid deployments are promoted by renaming a
 * timestamped schema onto `squid_marketplace` — which leaves oids untouched. A view would keep
 * serving the retired deployment's names with nothing to signal it, and it would also make the
 * retired schema undroppable. Rebuilding a table from a plain query has neither problem.
 */
export const SELECT_SEARCH_WORDS = selectWordsFrom(
  `SELECT items.id::text AS item_id, 1 AS entry, COALESCE(wb.name, em.name) AS name, 'name' AS source
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
      SELECT items.id::text AS item_id, 1 AS entry, collections.name AS name, 'collection' AS source
      FROM ${MARKETPLACE_SQUID_SCHEMA}.item AS items
      JOIN ${MARKETPLACE_SQUID_SCHEMA}.collection AS collections
        ON collections.id = items.collection_id
      UNION ALL
      SELECT items.id::text AS item_id, n.entry::int AS entry, n.name, 'creator' AS source
      FROM ${MARKETPLACE_SQUID_SCHEMA}.item AS items
      JOIN ${CREATOR_PROFILES_TABLE} AS cp
        ON cp.address = items.creator
      CROSS JOIN LATERAL unnest(array_prepend(cp.name, cp.names[1:${CREATOR_MAX_NAMES}])) WITH ORDINALITY AS n(name, entry)
      WHERE n.name IS NOT NULL`,
  'item_id'
)

/**
 * One row per (creator, searchable word, source), for the creator suggestions: the words of the profile
 * name and of EVERY NAME the creator holds — not the handful their items inherit — keyed by the creator,
 * so a NAME that is the query finds its holder however many they own. Sixteen hundred creators make this
 * some thousands of rows, so it is rebuilt alongside the item words rather than kept up to date on its own.
 */
const SELECT_CREATOR_SEARCH_WORDS = selectWordsFrom(
  `SELECT cp.address, n.entry::int AS entry, n.name, CASE WHEN n.entry = 1 THEN 'profile' ELSE 'ens' END AS source
      FROM ${CREATOR_PROFILES_TABLE} AS cp
      CROSS JOIN LATERAL unnest(array_prepend(cp.name, cp.names)) WITH ORDINALITY AS n(name, entry)
      WHERE n.name IS NOT NULL`,
  'address'
)

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

/**
 * One row per (creator, name) — the profile name and every NAME — in the two shapes the creator ranking
 * compares a query against: the normalized phrase and the same words sorted. Precomputed for the same
 * reason as the item names: one creator holds three thousand NAMEs, and normalizing them on each request
 * that reached them cost fifty milliseconds a keystroke.
 */
const SELECT_CREATOR_SEARCH_NAMES = `SELECT
      cp.address,
      ${SEARCH_PHRASE_FUNCTION}(n.name) AS phrase,
      (SELECT string_agg(word, ' ' ORDER BY word) FROM unnest(${SEARCH_TOKENS_FUNCTION}(n.name)) AS word) AS sorted_words
    FROM ${CREATOR_PROFILES_TABLE} AS cp
    CROSS JOIN LATERAL unnest(array_prepend(cp.name, cp.names)) AS n(name)
    WHERE n.name IS NOT NULL`

/**
 * One row per (collection, searchable word, source), for the collection suggestions: the collection's
 * name through the same tokenizer as everything else, so "coca cola", "coca-cola" and "cristobal" find
 * the collections the substring search used to miss.
 */
const SELECT_COLLECTION_SEARCH_WORDS = selectWordsFrom(SELECT_SEARCHABLE_COLLECTIONS, 'collection_id')

const DROP_SEARCH_WORDS_TABLE = `DROP TABLE IF EXISTS ${SEARCH_WORDS_TABLE}`
const DROP_SEARCH_NAMES_TABLE = `DROP TABLE IF EXISTS ${SEARCH_NAMES_TABLE}`
const DROP_CREATOR_SEARCH_WORDS_TABLE = `DROP TABLE IF EXISTS ${CREATOR_SEARCH_WORDS_TABLE}`
const DROP_CREATOR_SEARCH_NAMES_TABLE = `DROP TABLE IF EXISTS ${CREATOR_SEARCH_NAMES_TABLE}`
const DROP_COLLECTION_SEARCH_WORDS_TABLE = `DROP TABLE IF EXISTS ${COLLECTION_SEARCH_WORDS_TABLE}`
const DROP_COLLECTION_SEARCH_NAMES_TABLE = `DROP TABLE IF EXISTS ${COLLECTION_SEARCH_NAMES_TABLE}`

export type RebuildOutcome = 'rebuilt' | 'skipped'

type QueryableClient = { query: (sql: string) => Promise<{ rows: { acquired?: boolean }[] }> }

/**
 * Rebuilds the six search tables from scratch and swaps them in: the item words and names, the creator
 * words and names, the collection words and names.
 *
 * Everything happens in one transaction, and the live tables are only touched by the drop-and-rename at
 * the very end. So a failure part way through — including hitting the pool's statement timeout — rolls
 * back and leaves the current tables serving queries, to be retried on the next cycle. Readers block
 * only for the final renames, not for the build.
 *
 * A full rebuild costs well under a second at current catalog size, which is why there is no attempt to
 * compute a delta: doing the whole thing is both cheaper to reason about and correct after a squid
 * promotion or a creator profile refresh without any special casing.
 */
export async function rebuildSearchTables(client: QueryableClient): Promise<RebuildOutcome> {
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
    // The shop feeds ask "does THIS item match?" once per row, so they need to reach an item's handful of
    // words directly. The trigram index answers the opposite question and cannot serve that lookup.
    await client.query(`CREATE INDEX ${STAGING_ITEM_INDEX} ON ${STAGING_TABLE} (item_id)`)
    await client.query(`ANALYZE ${STAGING_TABLE}`)
    await client.query(`DROP TABLE IF EXISTS ${NAMES_STAGING_TABLE}`)
    await client.query(`CREATE TABLE ${NAMES_STAGING_TABLE} AS ${SELECT_SEARCH_NAMES}`)
    await client.query(`CREATE INDEX ${NAMES_STAGING_ITEM_INDEX} ON ${NAMES_STAGING_TABLE} (item_id)`)
    await client.query(`ANALYZE ${NAMES_STAGING_TABLE}`)
    await client.query(`DROP TABLE IF EXISTS ${CREATOR_STAGING_TABLE}`)
    await client.query(`CREATE TABLE ${CREATOR_STAGING_TABLE} AS ${SELECT_CREATOR_SEARCH_WORDS}`)
    await client.query(`CREATE INDEX ${CREATOR_STAGING_WORD_INDEX} ON ${CREATOR_STAGING_TABLE} USING gin (word ${TRIGRAM_OPS})`)
    await client.query(`CREATE INDEX ${CREATOR_STAGING_ADDRESS_INDEX} ON ${CREATOR_STAGING_TABLE} (address)`)
    await client.query(`ANALYZE ${CREATOR_STAGING_TABLE}`)
    await client.query(`DROP TABLE IF EXISTS ${CREATOR_NAMES_STAGING_TABLE}`)
    await client.query(`CREATE TABLE ${CREATOR_NAMES_STAGING_TABLE} AS ${SELECT_CREATOR_SEARCH_NAMES}`)
    await client.query(`CREATE INDEX ${CREATOR_NAMES_STAGING_ADDRESS_INDEX} ON ${CREATOR_NAMES_STAGING_TABLE} (address)`)
    await client.query(`ANALYZE ${CREATOR_NAMES_STAGING_TABLE}`)
    await client.query(`DROP TABLE IF EXISTS ${COLLECTION_STAGING_TABLE}`)
    await client.query(`CREATE TABLE ${COLLECTION_STAGING_TABLE} AS ${SELECT_COLLECTION_SEARCH_WORDS}`)
    await client.query(`CREATE INDEX ${COLLECTION_STAGING_WORD_INDEX} ON ${COLLECTION_STAGING_TABLE} USING gin (word ${TRIGRAM_OPS})`)
    await client.query(`CREATE INDEX ${COLLECTION_STAGING_COLLECTION_INDEX} ON ${COLLECTION_STAGING_TABLE} (collection_id)`)
    await client.query(`ANALYZE ${COLLECTION_STAGING_TABLE}`)
    await client.query(`DROP TABLE IF EXISTS ${COLLECTION_NAMES_STAGING_TABLE}`)
    await client.query(`CREATE TABLE ${COLLECTION_NAMES_STAGING_TABLE} AS ${SELECT_COLLECTION_SEARCH_NAMES}`)
    await client.query(`CREATE INDEX ${COLLECTION_NAMES_STAGING_COLLECTION_INDEX} ON ${COLLECTION_NAMES_STAGING_TABLE} (collection_id)`)
    await client.query(`ANALYZE ${COLLECTION_NAMES_STAGING_TABLE}`)

    await client.query(DROP_SEARCH_WORDS_TABLE)
    await client.query(`ALTER TABLE ${STAGING_TABLE} RENAME TO ${SEARCH_WORDS_TABLE_NAME}`)
    await client.query(`ALTER INDEX ${BUILDER_SERVER_TABLE_SCHEMA}.${STAGING_WORD_INDEX} RENAME TO ${SEARCH_WORDS_WORD_INDEX}`)
    await client.query(`ALTER INDEX ${BUILDER_SERVER_TABLE_SCHEMA}.${STAGING_ITEM_INDEX} RENAME TO ${SEARCH_WORDS_ITEM_INDEX}`)
    await client.query(DROP_SEARCH_NAMES_TABLE)
    await client.query(`ALTER TABLE ${NAMES_STAGING_TABLE} RENAME TO ${SEARCH_NAMES_TABLE_NAME}`)
    await client.query(`ALTER INDEX ${BUILDER_SERVER_TABLE_SCHEMA}.${NAMES_STAGING_ITEM_INDEX} RENAME TO ${SEARCH_NAMES_ITEM_INDEX}`)
    await client.query(DROP_CREATOR_SEARCH_WORDS_TABLE)
    await client.query(`ALTER TABLE ${CREATOR_STAGING_TABLE} RENAME TO ${CREATOR_SEARCH_WORDS_TABLE_NAME}`)
    await client.query(
      `ALTER INDEX ${BUILDER_SERVER_TABLE_SCHEMA}.${CREATOR_STAGING_WORD_INDEX} RENAME TO ${CREATOR_SEARCH_WORDS_WORD_INDEX}`
    )
    await client.query(
      `ALTER INDEX ${BUILDER_SERVER_TABLE_SCHEMA}.${CREATOR_STAGING_ADDRESS_INDEX} RENAME TO ${CREATOR_SEARCH_WORDS_ADDRESS_INDEX}`
    )
    await client.query(DROP_CREATOR_SEARCH_NAMES_TABLE)
    await client.query(`ALTER TABLE ${CREATOR_NAMES_STAGING_TABLE} RENAME TO ${CREATOR_SEARCH_NAMES_TABLE_NAME}`)
    await client.query(
      `ALTER INDEX ${BUILDER_SERVER_TABLE_SCHEMA}.${CREATOR_NAMES_STAGING_ADDRESS_INDEX} RENAME TO ${CREATOR_SEARCH_NAMES_ADDRESS_INDEX}`
    )
    await client.query(DROP_COLLECTION_SEARCH_WORDS_TABLE)
    await client.query(`ALTER TABLE ${COLLECTION_STAGING_TABLE} RENAME TO ${COLLECTION_SEARCH_WORDS_TABLE_NAME}`)
    await client.query(
      `ALTER INDEX ${BUILDER_SERVER_TABLE_SCHEMA}.${COLLECTION_STAGING_WORD_INDEX} RENAME TO ${COLLECTION_SEARCH_WORDS_WORD_INDEX}`
    )
    await client.query(
      `ALTER INDEX ${BUILDER_SERVER_TABLE_SCHEMA}.${COLLECTION_STAGING_COLLECTION_INDEX} RENAME TO ${COLLECTION_SEARCH_WORDS_COLLECTION_INDEX}`
    )
    await client.query(DROP_COLLECTION_SEARCH_NAMES_TABLE)
    await client.query(`ALTER TABLE ${COLLECTION_NAMES_STAGING_TABLE} RENAME TO ${COLLECTION_SEARCH_NAMES_TABLE_NAME}`)
    await client.query(
      `ALTER INDEX ${BUILDER_SERVER_TABLE_SCHEMA}.${COLLECTION_NAMES_STAGING_COLLECTION_INDEX} RENAME TO ${COLLECTION_SEARCH_NAMES_COLLECTION_INDEX}`
    )

    await client.query('COMMIT')
    return 'rebuilt'
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  }
}
