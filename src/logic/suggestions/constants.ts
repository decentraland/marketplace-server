import { BUILDER_SERVER_TABLE_SCHEMA } from '../../constants'

export const NEIGHBORS_TABLE_NAME = 'item_neighbors'
export const NEIGHBORS_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${NEIGHBORS_TABLE_NAME}`
export const NEIGHBORS_ITEM_INDEX = `idx_${NEIGHBORS_TABLE_NAME}_item_id`
export const NEIGHBORS_META_TABLE_NAME = 'item_neighbors_meta'
export const NEIGHBORS_META_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${NEIGHBORS_META_TABLE_NAME}`

/** Bumped whenever the maths change, so a stale table is recognisable and the A/B can split on it. */
export const ALGORITHM_VERSION = 'v1'

export type NeighborSource = 'cf' | 'content'

/**
 * Every constant below was fixed by the phase 0 offline evaluation (temporal holdout over dated
 * acquisitions, 264-410 wallets per cutoff). Do not re-tune them without re-running that evaluation:
 * the weights are only meaningful together.
 */

/** Unpaid acquisitions (airdrops, free claims) count for this much of a purchase. */
export const FREE_ACQUISITION_WEIGHT = 0.3
/** Neighbours kept per anchor item, per source. */
export const NEIGHBORS_PER_ITEM = 50
/** A co-ownership pair needs this many co-owners before it is trusted at all. */
export const MIN_CO_OWNERS = 3
/** Shrinks the cosine towards zero for thin pairs: sim * co / (co + this). */
export const CO_OWNERSHIP_SHRINKAGE = 10
/** Owners outside this band are dropped: one-item wallets carry no signal, 200+ are bots. */
export const MIN_WALLET_ITEMS = 2
export const MAX_WALLET_ITEMS = 200
/** Taste weights decay with e^(-age_days / this). */
export const RECENCY_DECAY_DAYS = 365
/** Tags this common carry no IDF signal; including them only inflates the content pass. */
export const MAX_TAG_DOCUMENT_FREQUENCY = 2000

export const CONTENT_WEIGHTS = {
  creator: 0.35,
  collection: 0.25,
  subCategory: 0.15,
  rarity: 0.1,
  tags: 0.1,
  priceBand: 0.05
}

/** Final blend over the per-wallet max-normalised components. */
export const SCORE_WEIGHTS = {
  cf: 0.45,
  content: 0.25,
  taste: 0.2,
  popularity: 0.1
}

/** Profile weights per signal (§4.1 of the spec). */
export const PROFILE_WEIGHTS = {
  paid: 1.0,
  free: FREE_ACQUISITION_WEIGHT,
  favorite: 1.2,
  equipped: 1.5,
  seed: 0.8
}

/** Diversity caps applied to the re-ranked head. */
export const MAX_PER_COLLECTION = 2
export const MAX_PER_CREATOR = 3
/** Wearable share used when the profile does not imply one. */
export const DEFAULT_WEARABLE_RATIO = 0.7
/** Below this many personally-sourced rows the response is not worth calling personalised. */
export const MIN_PERSONAL_ROWS = 4

export const SUGGESTED_DEFAULT_LIMIT = 12
export const SUGGESTED_MAX_LIMIT = 40
export const MAX_SEEDS = 20
export const MAX_EQUIPPED = 30
export const MAX_EXCLUDE = 20
/**
 * Strongest profile entries carried into the scoring query.
 *
 * Production holds wallets with six figures of items (the largest is ~144k). Every profile entry
 * becomes three bind parameters in a VALUES list, so an uncapped profile blows Postgres' 65535-parameter
 * limit and the request fails outright. The cap matches the neighbours job's owner band on purpose: past
 * a couple of hundred items a wallet is a collection rather than a taste, and the profile is sorted by
 * weight, so what survives is the recent, paid, worn and favourited end of it.
 */
export const MAX_PROFILE_ITEMS = 200

/** Candidates pulled from SQL before the diversity re-rank trims to `first`. */
export const CANDIDATE_MULTIPLIER = 3

export const SUGGESTIONS_CACHE_TTL_SECONDS = 600
export const OWNED_SET_CACHE_TTL_SECONDS = 3600
