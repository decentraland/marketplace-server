import { BUILDER_SERVER_TABLE_SCHEMA, MARKETPLACE_SQUID_SCHEMA } from '../../constants'

export const SEARCH_WORDS_TABLE_NAME = 'item_search_words'
export const SEARCH_WORDS_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${SEARCH_WORDS_TABLE_NAME}`
export const SEARCH_WORDS_WORD_INDEX = `idx_${SEARCH_WORDS_TABLE_NAME}_word_trgm`

const STAGING_TABLE_NAME = `${SEARCH_WORDS_TABLE_NAME}_staging`
const STAGING_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${STAGING_TABLE_NAME}`
const STAGING_WORD_INDEX = `${SEARCH_WORDS_WORD_INDEX}_staging`

// Any positive constant works; it only has to be the same in every instance of this service.
const REBUILD_ADVISORY_LOCK_KEY = 8_421_207

// pg_trgm is installed in `public`, but migrations run with search_path set to the marketplace schema
// alone, so an unqualified operator class does not resolve there. Naming the schema keeps this index
// buildable from both the migration and the rebuild job, whatever their search_path happens to be.
const TRIGRAM_OPS = 'public.gin_trgm_ops'

/**
 * One row per (item, word of its name). `word` is lowercased and carries the trigram index used for
 * matching; `original_word` keeps the name's own casing, because it is reported back as the matched
 * term in search analytics.
 *
 * This is a plain table rather than a materialized view on purpose. A materialized view resolves its
 * source tables once and holds them by oid, and squid deployments are promoted by renaming a
 * timestamped schema onto `squid_marketplace` — which leaves oids untouched. A view would keep
 * serving the retired deployment's names with nothing to signal it, and it would also make the
 * retired schema undroppable. Rebuilding a table from a plain query has neither problem.
 */
const SELECT_SEARCH_WORDS = `SELECT DISTINCT
      items.id::text AS item_id,
      lower(w.text) AS word,
      w.text AS original_word
    FROM ${MARKETPLACE_SQUID_SCHEMA}.item AS items
    JOIN ${MARKETPLACE_SQUID_SCHEMA}.metadata AS md
      ON md.id = items.metadata_id
    LEFT JOIN ${MARKETPLACE_SQUID_SCHEMA}.wearable AS wb
      ON wb.id = md.wearable_id
     AND md.item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1')
    LEFT JOIN ${MARKETPLACE_SQUID_SCHEMA}.emote AS em
      ON em.id = md.emote_id
     AND md.item_type = 'emote_v1'
    CROSS JOIN LATERAL unnest(string_to_array(COALESCE(wb.name, em.name), ' ')) AS w(text)
    WHERE w.text <> ''`

export const CREATE_SEARCH_WORDS_TABLE = `CREATE TABLE IF NOT EXISTS ${SEARCH_WORDS_TABLE} AS ${SELECT_SEARCH_WORDS}`
export const CREATE_SEARCH_WORDS_WORD_INDEX = `CREATE INDEX IF NOT EXISTS ${SEARCH_WORDS_WORD_INDEX} ON ${SEARCH_WORDS_TABLE} USING gin (word ${TRIGRAM_OPS})`
export const DROP_SEARCH_WORDS_TABLE = `DROP TABLE IF EXISTS ${SEARCH_WORDS_TABLE}`

export type RebuildOutcome = 'rebuilt' | 'skipped'

type QueryableClient = { query: (sql: string) => Promise<{ rows: { acquired?: boolean }[] }> }

/**
 * Rebuilds the table from scratch and swaps it in.
 *
 * Everything happens in one transaction, and the live table is only touched by the drop-and-rename at
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
    await client.query(`ANALYZE ${STAGING_TABLE}`)

    await client.query(DROP_SEARCH_WORDS_TABLE)
    await client.query(`ALTER TABLE ${STAGING_TABLE} RENAME TO ${SEARCH_WORDS_TABLE_NAME}`)
    await client.query(`ALTER INDEX ${BUILDER_SERVER_TABLE_SCHEMA}.${STAGING_WORD_INDEX} RENAME TO ${SEARCH_WORDS_WORD_INDEX}`)

    await client.query('COMMIT')
    return 'rebuilt'
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  }
}
