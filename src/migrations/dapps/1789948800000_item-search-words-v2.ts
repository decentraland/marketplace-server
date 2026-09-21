/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'
import { CREATE_SEARCH_NORMALIZATION_FUNCTIONS, DROP_SEARCH_NORMALIZATION_FUNCTIONS } from '../../logic/catalog/search-normalization'
import {
  CREATE_SEARCH_NAMES_ITEM_INDEX,
  CREATE_SEARCH_NAMES_TABLE,
  CREATE_SEARCH_WORDS_ITEM_INDEX,
  CREATE_SEARCH_WORDS_TABLE,
  CREATE_SEARCH_WORDS_WORD_INDEX,
  DROP_SEARCH_NAMES_TABLE,
  DROP_SEARCH_WORDS_TABLE
} from '../../logic/catalog/search-words-table'

// The search words table, reshaped: words are normalized (lowercased, unaccented, split on punctuation)
// through SQL functions the query side shares, each carries which name it came from (the item's or its
// collection's), and a hyphenated or multi-word name also yields its collapsed forms ("T-Shirt" → t,
// shirt, tshirt; "Golf Craft" → golfcraft). A second table holds each item's normalized name for the
// exact-name bonus of the ranking. Both are built here so the new shape serves from the first request
// after deploy; the catalog job then rebuilds them every few minutes, so `down` is not a lasting inverse.
//
// `unaccent` is a trusted extension: creating it needs CREATE on the database, which the role that runs
// these migrations has (it owns the table this replaces).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;')
  for (const statement of CREATE_SEARCH_NORMALIZATION_FUNCTIONS) pgm.sql(`${statement};`)
  pgm.sql(`${DROP_SEARCH_WORDS_TABLE};`)
  pgm.sql(`${CREATE_SEARCH_WORDS_TABLE};`)
  pgm.sql(`${CREATE_SEARCH_WORDS_WORD_INDEX};`)
  pgm.sql(`${CREATE_SEARCH_WORDS_ITEM_INDEX};`)
  pgm.sql(`${DROP_SEARCH_NAMES_TABLE};`)
  pgm.sql(`${CREATE_SEARCH_NAMES_TABLE};`)
  pgm.sql(`${CREATE_SEARCH_NAMES_ITEM_INDEX};`)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`${DROP_SEARCH_NAMES_TABLE};`)
  pgm.sql(`${DROP_SEARCH_WORDS_TABLE};`)
  for (const statement of DROP_SEARCH_NORMALIZATION_FUNCTIONS) pgm.sql(`${statement};`)
}
