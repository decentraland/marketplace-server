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
