import { BUILDER_SERVER_TABLE_SCHEMA } from '../../constants'

export const SEARCH_TOKENS_FUNCTION = `${BUILDER_SERVER_TABLE_SCHEMA}.search_tokens`
export const SEARCH_PHRASE_FUNCTION = `${BUILDER_SERVER_TABLE_SCHEMA}.search_phrase`
export const SEARCH_QUERY_TERMS_FUNCTION = `${BUILDER_SERVER_TABLE_SCHEMA}.search_query_terms`

/**
 * Words a query drops, but only when it has anything else left to search for. "atari x rtfkt" is a search
 * for atari and rtfkt; the bare "x" in the middle matches the hundreds of collab items named "A x B" and
 * would swamp both. "x" on its own stays a valid query, because those items really are what it names.
 */
export const SEARCH_STOPWORDS = ['the', 'a', 'an', 'of', 'and', 'x', 'de', 'la', 'el', 'los', 'las', 'y']

/** A query longer than this is truncated: every extra term is another index probe, and nobody types seven. */
export const SEARCH_MAX_TERMS = 6

// Every name is schema-qualified because migrations and the rebuild job run with search_path set to the
// marketplace schema alone: an unqualified `unaccent` would neither find the function nor its dictionary.
const UNACCENT_DICTIONARY = "'public.unaccent'::regdictionary"

/**
 * The ONE normalization every search string goes through, on both sides of the match: the words stored
 * in the search table and the terms a query is split into. It lives in SQL so there is exactly one
 * implementation, rather than a TypeScript copy that has to be kept in step with it.
 *
 * NFC → lower → split on anything that is not a letter or digit → strip diacritics → drop empties.
 * Composing first (NFC) is what makes "Máscara" typed with a combining accent the same word as the
 * precomposed one: decomposed, the accent is a separate mark, not a letter, and the split would cut the
 * word in two. Splitting BEFORE unaccent matters too: unaccent expands some symbols into several
 * characters ('©' → '(C)', '½' → ' 1/2'), so a symbol has to be gone before it can be expanded. Letters
 * it expands stay letters ('ß' → 'ss', 'æ' → 'ae'); the trailing replace is insurance against the rule
 * file changing that.
 */
const CREATE_SEARCH_TOKENS_FUNCTION = `CREATE OR REPLACE FUNCTION ${SEARCH_TOKENS_FUNCTION}(input text) RETURNS text[]
  LANGUAGE sql STABLE PARALLEL SAFE AS $fn$
    SELECT COALESCE(pg_catalog.array_agg(t.token ORDER BY t.ordinality), '{}'::text[])
    FROM (
      SELECT
        pg_catalog.regexp_replace(public.unaccent(${UNACCENT_DICTIONARY}, parts.part), '[^[:alnum:]]', '', 'g') AS token,
        parts.ordinality
      FROM pg_catalog.regexp_split_to_table(pg_catalog.lower(normalize(COALESCE(input, ''), NFC)), '[^[:alnum:]]+')
        WITH ORDINALITY AS parts(part, ordinality)
    ) t
    WHERE t.token <> ''
  $fn$`

/** The normalized tokens joined by one space: the whole string, with nothing dropped, for exact comparisons. */
const CREATE_SEARCH_PHRASE_FUNCTION = `CREATE OR REPLACE FUNCTION ${SEARCH_PHRASE_FUNCTION}(input text) RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE AS $fn$
    SELECT pg_catalog.array_to_string(${SEARCH_TOKENS_FUNCTION}(input), ' ')
  $fn$`

/**
 * The terms a query is matched by: one per whitespace-separated word, each collapsed to its letters and
 * digits ("t-shirt" → tshirt, "o'brien" → obrien), deduplicated in first-seen order, minus the stopwords
 * (kept when nothing else remains), capped.
 *
 * A word is collapsed by joining what search_tokens makes of it — the SAME cleaning the stored words went
 * through, symbols included. Cleaning it any other way diverged: unaccent run on the whole word expanded
 * '©' into '(C)' and '½' into '12', so a query carrying a symbol reached words the index never stored.
 *
 * Collapsing rather than splitting is what the stored words are built for: a hyphenated name is stored
 * as its parts AND as one token, and adjacent words as one token too, so the collapsed query reaches
 * "T-Shirt", "Tshirt" and "T Shirt" alike. Split into t + shirt it could not reach "Tshirt" at all.
 *
 * Kept separate from search_phrase on purpose: the phrase is what a tag or an exact name is compared
 * against, and it must not lose "the" from "the world is yours".
 */
const CREATE_SEARCH_QUERY_TERMS_FUNCTION = `CREATE OR REPLACE FUNCTION ${SEARCH_QUERY_TERMS_FUNCTION}(input text) RETURNS text[]
  LANGUAGE sql STABLE PARALLEL SAFE AS $fn$
    WITH words AS (
      SELECT
        pg_catalog.array_to_string(${SEARCH_TOKENS_FUNCTION}(w.word), '') AS term,
        w.ordinality
      FROM pg_catalog.regexp_split_to_table(COALESCE(input, ''), '\\s+') WITH ORDINALITY AS w(word, ordinality)
    ), tokens AS (
      SELECT term, MIN(ordinality) AS ordinality
      FROM words
      WHERE term <> ''
      GROUP BY term
    ), kept AS (
      SELECT term, ordinality FROM tokens
      WHERE term <> ALL ('{${SEARCH_STOPWORDS.join(',')}}'::text[])
    )
    SELECT COALESCE(pg_catalog.array_agg(l.term ORDER BY l.ordinality), '{}'::text[])
    FROM (
      SELECT term, ordinality FROM kept
      UNION ALL
      SELECT term, ordinality FROM tokens WHERE NOT EXISTS (SELECT 1 FROM kept)
      ORDER BY ordinality
      LIMIT ${SEARCH_MAX_TERMS}
    ) l
  $fn$`

// In dependency order: phrase and query terms are built on top of tokens.
export const CREATE_SEARCH_NORMALIZATION_FUNCTIONS = [
  CREATE_SEARCH_TOKENS_FUNCTION,
  CREATE_SEARCH_PHRASE_FUNCTION,
  CREATE_SEARCH_QUERY_TERMS_FUNCTION
]

export const DROP_SEARCH_NORMALIZATION_FUNCTIONS = [
  `DROP FUNCTION IF EXISTS ${SEARCH_QUERY_TERMS_FUNCTION}(text)`,
  `DROP FUNCTION IF EXISTS ${SEARCH_PHRASE_FUNCTION}(text)`,
  `DROP FUNCTION IF EXISTS ${SEARCH_TOKENS_FUNCTION}(text)`
]
