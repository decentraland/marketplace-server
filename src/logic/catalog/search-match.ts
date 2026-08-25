import SQL, { SQLStatement } from 'sql-template-strings'
import { BUILDER_SERVER_TABLE_SCHEMA } from '../../constants'
import { SEARCH_WORDS_TABLE } from './search-words-table'

/**
 * Does this item match a search term?
 *
 * Every shop feed used to answer this with `name ILIKE '%term%'`, which is a literal substring over the
 * whole name. That fails the moment a query's words are not adjacent in that exact order — "hat pirate"
 * matched nothing at all — and it never looked at tags, which is where creators put brand and collab
 * names. Matching word by word against the pre-split, trigram-indexed word table fixes both, and is
 * also cheaper: the substring form could not use an index.
 *
 * Tags match exactly (case-insensitively), which is how the collectibles catalog has always treated
 * them: a tag is a label someone chose, not prose to fuzzy-match against.
 *
 * MULTI-WORD QUERIES compare each stored word against the WHOLE phrase, not term by term — the same rule
 * /v2/catalog has always used, which is what lets the two products agree on what a query matches. It
 * leans on `pg_trgm.similarity_threshold`, left at its 0.3 default in production, and that threshold
 * bites differently as a phrase grows: `similarity('golf', 'golf craft shoes')` is 0.294, so "golf" alone
 * falls just under it while "shoes" (0.353) and "golfcraft" (0.421) clear it.
 *
 * The two obvious alternatives were measured against real searches from the telemetry before settling
 * here, and both are worse:
 *  - requiring EVERY term to match some word collapses recall — "golf craft shoes" 416 -> 12,
 *    "city decentraland sneakers" 244 -> 1, "hat pirate" 565 -> 3;
 *  - matching each term independently and OR-ing floods on noise tokens — "atari x rtfkt" 49 -> 1086,
 *    because the bare "x" matches almost anything.
 *
 * What multi-word search actually wants is the OR for recall plus a rank by how many terms an item
 * matched. That needs a relevance sort, and these feeds sort by price or recency, so it is a change to
 * the shop's ordering rather than to this predicate.
 *
 * `itemIdExpression` is raw SQL naming the item id in the caller's query, e.g. `item.id::text` or
 * `COALESCE(item_p.id, item_s.id)`. It is a caller-controlled constant, never user input.
 */
export function getSearchMatchWhere(itemIdExpression: string, search: string): SQLStatement {
  return SQL`(EXISTS (
      SELECT 1
      FROM `
    .append(SEARCH_WORDS_TABLE)
    .append(
      SQL` AS search_words
      WHERE search_words.item_id = `
    )
    .append(itemIdExpression)
    .append(
      SQL`
        AND search_words.word % lower(${search})
    ) OR EXISTS (
      SELECT 1
      FROM `
    )
    .append(BUILDER_SERVER_TABLE_SCHEMA)
    .append(
      SQL`.mv_builder_server_items AS search_tags
      WHERE search_tags.item_id = `
    )
    .append(itemIdExpression).append(SQL`
        AND lower(search_tags.tag) = lower(${search})
    ))`)
}
