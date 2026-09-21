import SQL, { SQLStatement } from 'sql-template-strings'
import { BUILDER_SERVER_TABLE_SCHEMA, MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { SEARCH_PHRASE_FUNCTION, SEARCH_QUERY_TERMS_FUNCTION, SEARCH_TOKENS_FUNCTION } from './search-normalization'

export const COLLECTION_SEARCH_WORDS_TABLE_NAME = 'collection_search_words'
export const COLLECTION_SEARCH_WORDS_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${COLLECTION_SEARCH_WORDS_TABLE_NAME}`
export const COLLECTION_SEARCH_NAMES_TABLE_NAME = 'collection_search_names'
export const COLLECTION_SEARCH_NAMES_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${COLLECTION_SEARCH_NAMES_TABLE_NAME}`

/**
 * The window the sales tiebreak counts over. A brand word names many collections — "rtfkt" ten, "doki"
 * fifty-eight — and among them the one people are buying from is the one to offer first; the item count
 * used to decide, and put a ten-year-old drop above the current one. The same window as the trending
 * rail, so "what sells now" means the same thing across the shop.
 */
export const COLLECTION_SALES_WINDOW_DAYS = 90

export const COLLECTION_SUGGEST_DEFAULT_LIMIT = 4
export const COLLECTION_SUGGEST_MAX_LIMIT = 10

// The same bonuses an item name earns, so the three rankings read alike.
const EXACT_NAME_BONUS = 1.0
const NAME_PREFIX_BONUS = 0.5

/**
 * The collections the suggestions can offer, in the shape the shared tokenizer takes: approved, with at
 * least one approved item — a collection with nothing to browse is not something to send anyone to.
 */
export const SELECT_SEARCHABLE_COLLECTIONS = `SELECT c.id AS collection_id, 1 AS entry, c.name, 'name' AS source
      FROM ${MARKETPLACE_SQUID_SCHEMA}.collection AS c
      WHERE c.is_approved = true
        AND EXISTS (
          SELECT 1 FROM ${MARKETPLACE_SQUID_SCHEMA}.item AS i
          WHERE i.collection_id = c.id AND i.search_is_collection_approved = true
        )`

/**
 * One row per searchable collection with its name in the two shapes the ranking compares a query against,
 * plus the two numbers ties are broken on: sales in the window and approved items. Precomputed with the
 * words rather than at request time, like the item and creator names.
 */
export const SELECT_COLLECTION_SEARCH_NAMES = `SELECT
      c.id AS collection_id,
      ${SEARCH_PHRASE_FUNCTION}(c.name) AS phrase,
      (SELECT string_agg(word, ' ' ORDER BY word) FROM unnest(${SEARCH_TOKENS_FUNCTION}(c.name)) AS word) AS sorted_words,
      counted.items,
      COALESCE(sold.sales, 0) AS sales
    FROM ${MARKETPLACE_SQUID_SCHEMA}.collection AS c
    JOIN (
      SELECT collection_id, COUNT(*)::int AS items
      FROM ${MARKETPLACE_SQUID_SCHEMA}.item
      WHERE search_is_collection_approved = true
      GROUP BY collection_id
    ) AS counted ON counted.collection_id = c.id
    LEFT JOIN (
      SELECT i.collection_id, COUNT(*)::int AS sales
      FROM ${MARKETPLACE_SQUID_SCHEMA}.sale AS s
      JOIN ${MARKETPLACE_SQUID_SCHEMA}.item AS i ON i.id = s.item_id
      WHERE s.timestamp > EXTRACT(EPOCH FROM now() - interval '${COLLECTION_SALES_WINDOW_DAYS} days')
      GROUP BY i.collection_id
    ) AS sold ON sold.collection_id = c.id
    WHERE c.is_approved = true`

export type CollectionSearchRow = {
  collection_id: string
  name: string
  creator: string
  items: number
  sales: number
  score: number
}

/**
 * Collections whose name matches every term of the query, best first — or, only when none matches them
 * all, the ones matching the most.
 *
 * The same matching as the item feeds — normalized query terms against pre-split words, `<%` under the
 * trigram index, the best hit per term — with containment, as for an item's own words: a collection's
 * name describes the collection, so "duck" finding "Duck Race Starducks Collection" is right, unlike a
 * creator's NAME hanging on their whole catalogue. Ranked by the summed similarity plus a bonus for a
 * name that IS the query, then one that STARTS with it; ties go to the collection selling most in the
 * window, then to the bigger one, then by name and id, so pages are stable.
 */
export function getCollectionSearchQuery(search: string, first: number): SQLStatement {
  return SQL``
    .append(
      `WITH search_terms AS (
      SELECT t.term
      FROM unnest(${SEARCH_QUERY_TERMS_FUNCTION}(`
    )
    .append(SQL`${search}`)
    .append(
      `)) AS t(term)
    ), search_term_hits AS (
      SELECT w.collection_id, t.term, MAX(word_similarity(t.term, w.word))::float8 AS best
      FROM ${COLLECTION_SEARCH_WORDS_TABLE} AS w
      JOIN search_terms AS t ON t.term <% w.word
      GROUP BY w.collection_id, t.term
    ), search_hits AS (
      SELECT collection_id, COUNT(*)::int AS matched, SUM(best)::float8 AS score
      FROM search_term_hits
      GROUP BY collection_id
    ), search_query AS (
      SELECT
        ${SEARCH_PHRASE_FUNCTION}(`
    )
    .append(SQL`${search}`)
    .append(
      `) AS phrase,
        (SELECT string_agg(word, ' ' ORDER BY word) FROM unnest(${SEARCH_TOKENS_FUNCTION}(`
    )
    .append(SQL`${search}`)
    .append(
      `)) AS word) AS sorted_words
    )
    SELECT
      c.id AS collection_id,
      c.name,
      c.creator,
      n.items,
      n.sales,
      (h.score + CASE
        WHEN n.sorted_words = q.sorted_words THEN ${EXACT_NAME_BONUS}
        WHEN starts_with(n.phrase, q.phrase) THEN ${NAME_PREFIX_BONUS}
        ELSE 0
      END)::float8 AS score
    FROM search_hits AS h
    JOIN ${COLLECTION_SEARCH_NAMES_TABLE} AS n ON n.collection_id = h.collection_id
    JOIN ${MARKETPLACE_SQUID_SCHEMA}.collection AS c ON c.id = h.collection_id
    CROSS JOIN search_query AS q
    WHERE h.matched = (SELECT MAX(matched) FROM search_hits)
    ORDER BY score DESC, n.sales DESC, n.items DESC, c.name ASC, c.id ASC
    LIMIT `
    )
    .append(SQL`${first}`)
}
