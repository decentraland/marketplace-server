import SQL, { SQLStatement } from 'sql-template-strings'
import { BUILDER_SERVER_TABLE_SCHEMA } from '../../constants'
import { ShopSortBy } from '../../ports/shop-catalog/types'
import {
  CREATOR_NAME_MIN_SIMILARITY,
  SEARCH_PHRASE_FUNCTION,
  SEARCH_QUERY_TERMS_FUNCTION,
  SEARCH_TOKENS_FUNCTION
} from './search-normalization'
import { SEARCH_NAMES_TABLE, SEARCH_WORDS_TABLE } from './search-words-table'

/** The CTE a searching statement joins: one row per matching item, with `matched` terms and a `score`. */
export const SEARCH_MATCHES_CTE = 'search_matches'
/** The alias every feed joins that CTE under, so the WHERE, the SELECT and the ORDER BY agree on it. */
export const SEARCH_MATCH_ALIAS = 'search_match'
/** The alias of the level-filtered relation `applySearchLevel` returns; a caller's ORDER BY reads columns off it. */
export const SEARCH_LEVEL_ALIAS = 'f'

// A word taken from the collection's name counts less than one from the item's own: "MVFW" names the show,
// not the garment, so an item that carries the term in its own name should outrank one that inherits it.
const COLLECTION_WORD_WEIGHT = 0.7
// A creator's name on an item: below the item's own name, above its collection's. "metatiger" should rank
// an item actually named that over METATIGER's other work, but a creator's name is a closer identity than
// the collection an item happens to sit in, and most of the queries that used to return nothing were one.
const CREATOR_WORD_WEIGHT = 0.8
// A tag equal to the whole query is a deliberate label, but the item's name still says nothing about it.
const TAG_MATCH_SCORE = 0.8
// Well above any term score, so a name that IS the query heads the list whatever the terms weigh.
const EXACT_NAME_BONUS = 1.0
const NAME_PREFIX_BONUS = 0.5

// Escape LIKE metacharacters so the term is matched literally. The value is bound as a parameter (no
// injection); this only stops a `%` or `_` in a search from turning it into an unbounded wildcard.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/**
 * The CTEs a searching statement opens with, returned WITHOUT the leading `WITH` so a statement that
 * already has one can append them to it.
 *
 * `search_terms` is the query split by `search_query_terms` (normalized, deduplicated, stopwords dropped
 * when anything else remains). `search_term_hits` keeps the BEST hit per (item, term): a term that is
 * similar to three of an item's words scores once, not three times, so an item cannot climb the ranking by
 * repeating a word. `search_matches` then folds that to one row per item — `matched` distinct terms and the
 * sum of those best scores — and merges the tag path into the same rows, so an item that matches by both
 * still appears exactly once and is counted once.
 *
 * Each term's best score is weighted by how rare the term is among the hits (1 / ln(1 + items it reached)),
 * so when a query relaxes to partial matches the items that carry its RARE word come first: "fisherman hat"
 * lists the fisherman items before the five hundred hats. Among items that matched every term the weights
 * are the same for all, so only the similarity and the name bonuses decide.
 *
 * The score also carries a bonus for a name that IS the query — its words in any order — and a smaller one
 * for a name that starts with it as a whole word: "Hat" and "Hat Pirate" above "Pirate Hat", all three above
 * "Hatch". Both sides are compared in the normalized shapes `item_search_names` precomputes, so accents,
 * case and punctuation cannot break the comparison, and nothing is normalized per row at query time.
 *
 * Matching is `term <% word`: pg_trgm's word_similarity, which is the similarity of the term to the most
 * similar PART of the word. That is what makes typing work — "sh" against "shoes" is 0.67, where whole-word
 * similarity is 0.29 — and what tolerates a typo ("corupted" ~ "corrupted" is 0.73). It is not a prefix
 * test: "hat" also reaches "hatch". The operator uses the GIN trigram index on `word` and compares against
 * `pg_trgm.word_similarity_threshold`, which production leaves at its 0.6 default; the threshold is part of
 * this contract and is deliberately not changed per session.
 *
 * Tags match the raw query exactly, as they always have: a tag is a label someone chose, not prose, and the
 * `lower(tag)` index only serves an exact comparison.
 */
export function getSearchCteDefinitions(search: string): SQLStatement {
  return SQL``
    .append(
      `search_terms AS (
      SELECT t.term
      FROM unnest(${SEARCH_QUERY_TERMS_FUNCTION}(`
    )
    .append(SQL`${search}`)
    .append(
      `)) AS t(term)
    ), search_term_hits AS (
      SELECT
        w.item_id,
        t.term,
        MAX(word_similarity(t.term, w.word) * CASE w.source WHEN 'name' THEN 1.0 WHEN 'creator' THEN ${CREATOR_WORD_WEIGHT} ELSE ${COLLECTION_WORD_WEIGHT} END)::float8 AS best
      FROM ${SEARCH_WORDS_TABLE} AS w
      JOIN search_terms AS t
        ON t.term <% w.word
       AND (w.source <> 'creator' OR similarity(t.term, w.word) >= ${CREATOR_NAME_MIN_SIMILARITY})
      GROUP BY w.item_id, t.term
    ), search_term_weights AS (
      SELECT term, (1.0 / ln(1.0 + COUNT(*)))::float8 AS weight
      FROM search_term_hits
      GROUP BY term
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
    ), search_item_hits AS (
      SELECT hits.item_id, MAX(hits.matched)::int AS matched, SUM(hits.score)::float8 AS score
      FROM (
        SELECT h.item_id, COUNT(*)::int AS matched, SUM(h.best * tw.weight)::float8 AS score
        FROM search_term_hits AS h
        JOIN search_term_weights AS tw ON tw.term = h.term
        GROUP BY h.item_id
        UNION ALL
        SELECT DISTINCT tags.item_id, (SELECT COUNT(*) FROM search_terms)::int AS matched, ${TAG_MATCH_SCORE}::float8 AS score
        FROM ${BUILDER_SERVER_TABLE_SCHEMA}.mv_builder_server_items AS tags
        WHERE lower(tags.tag) = lower(`
    )
    .append(SQL`${search.trim()}`)
    .append(
      `)
      ) AS hits
      GROUP BY hits.item_id
    ), ${SEARCH_MATCHES_CTE} AS (
      SELECT
        h.item_id,
        h.matched,
        (h.score + CASE
          WHEN n.sorted_words = q.sorted_words THEN ${EXACT_NAME_BONUS}
          WHEN n.phrase LIKE q.phrase || ' %' THEN ${NAME_PREFIX_BONUS}
          ELSE 0
        END)::float8 AS score
      FROM search_item_hits AS h
      CROSS JOIN search_query AS q
      LEFT JOIN ${SEARCH_NAMES_TABLE} AS n ON n.item_id = h.item_id
    )`
    )
}

/**
 * Joins the matches to the feed's rows. LEFT, on purpose: rows that are not collection items at all
 * (names, LAND, estates) have no entry to join and must stay reachable through the fallback in
 * getSearchMatchWhere.
 *
 * `itemIdExpression` is raw SQL naming the item id in the caller's query, e.g. `item.id::text` or
 * `COALESCE(item_p.id, item_s.id)::text`. It is a caller-controlled constant, never user input.
 */
export function getSearchMatchJoin(itemIdExpression: string): SQLStatement {
  return SQL``.append(` LEFT JOIN ${SEARCH_MATCHES_CTE} AS ${SEARCH_MATCH_ALIAS} ON ${SEARCH_MATCH_ALIAS}.item_id = ${itemIdExpression} `)
}

/**
 * Does this row match the search? An item matches when its id is among the CTE's. Spelled as `IN (SELECT …)`
 * rather than as a test on the joined columns on purpose: Postgres runs an uncorrelated IN as one hashed
 * probe per row, and because the predicate names only the feed's own columns it is applied BEFORE the LEFT
 * JOIN that fetches the score — so the join, a scan of the CTE per row, runs for the matching rows only.
 * Tested on the join's columns instead, the feed joined every open listing to the CTE first and filtered
 * after, which was three times slower on a common word.
 *
 * The level filter — which of the matched rows are shown — is applied later by applySearchLevel, over the
 * feed's already-filtered rows.
 *
 * `nonItemNameExpression` covers the rows that are not collection items at all — LAND, estates, names.
 * They have no id to look up (both sides of that COALESCE are NULL), so without a fallback a search
 * would silently exclude every one of them: 298 open name trades, 111 parcels and 82 estates today.
 * There is no word table for them either, so the fallback keeps the substring match on the asset's own
 * name, which is what these rows matched on before.
 */
export function getSearchMatchWhere(
  itemIdExpression: string,
  search: string,
  { nonItemNameExpression }: { nonItemNameExpression?: string } = {}
): SQLStatement {
  const query = SQL``.append(`(${itemIdExpression} IN (SELECT item_id FROM ${SEARCH_MATCHES_CTE})`)

  if (nonItemNameExpression) {
    query
      .append(` OR (${itemIdExpression} IS NULL AND ${nonItemNameExpression} ILIKE `)
      .append(SQL`${`%${escapeLike(search)}%`}`)
      .append(')')
  }

  return query.append(')')
}

/**
 * The two columns a searching row carries, for the level filter and the relevance sort. Both are NULL for a
 * row that is not a collection item, which is what keeps those rows out of the ranking's way.
 */
export function getSearchScoreColumns(): SQLStatement {
  return SQL``.append(`${SEARCH_MATCH_ALIAS}.matched AS search_matched, ${SEARCH_MATCH_ALIAS}.score AS search_score`)
}

/**
 * Keeps the rows that matched the most terms, relaxing only when nothing matched them all.
 *
 * `core` is the feed's whole SELECT with every one of ITS filters applied — on sale, category, rarity,
 * price, collection — but no total, no ORDER BY and no LIMIT. The level is the highest `search_matched`
 * among THOSE rows, so a query whose only full match is out of stock, or in another category, still
 * relaxes to the partial matches this surface can show, and the rows, the count and the level all come
 * from the same set. A row with a NULL `search_matched` is not an item (see getSearchMatchWhere) and
 * passes regardless.
 *
 * The count is taken above the level filter, so it counts what the page shows. The returned relation is
 * aliased SEARCH_LEVEL_ALIAS; a caller's ORDER BY and LIMIT go after it and read its output columns.
 */
export function applySearchLevel(core: SQLStatement, countAlias: string): SQLStatement {
  return SQL``
    .append(
      `SELECT ${SEARCH_LEVEL_ALIAS}.*, COUNT(*) OVER () AS ${countAlias}
      FROM (
        SELECT c.*, MAX(c.search_matched) OVER () AS search_required
        FROM (`
    )
    .append(core).append(`) AS c
      ) AS ${SEARCH_LEVEL_ALIAS}
      WHERE ${SEARCH_LEVEL_ALIAS}.search_matched IS NULL OR ${SEARCH_LEVEL_ALIAS}.search_matched >= ${SEARCH_LEVEL_ALIAS}.search_required`)
}

/**
 * ORDER BY for `sortBy=relevance`: most terms matched first, then the score, then the caller's own
 * tiebreak so equal scores page deterministically. NULLS LAST sends the non-item rows to the end.
 * `alias` names the relation the columns are read from; `tiebreak` is raw SQL and never user input.
 */
export function getRelevanceOrderBy(alias: string, tiebreak: string): SQLStatement {
  return SQL``.append(` ORDER BY ${alias}.search_matched DESC NULLS LAST, ${alias}.search_score DESC NULLS LAST, ${tiebreak}`)
}

/**
 * The sort a feed actually applies. Relevance is the default of a search and meaningless without one:
 * every row would tie, so `relevance` with no search falls back to the feed's default instead of sorting
 * on a column that is not there.
 */
export function resolveShopSortBy(sortBy: ShopSortBy | undefined, search: string | undefined): ShopSortBy {
  if (search) return sortBy ?? 'relevance'
  return sortBy === 'relevance' || sortBy === undefined ? 'newest' : sortBy
}
