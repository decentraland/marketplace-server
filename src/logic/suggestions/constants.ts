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

/**
 * What an unpaid acquisition — an airdrop, a free claim, a gift — is worth as evidence of taste.
 *
 * Zero, measured. Once a wallet's minting and buying histories are read as one person there are five
 * to fifteen unpaid acquisitions for every purchase, and at any non-trivial weight they swamp both the
 * profile and the co-ownership vectors: on the same evaluation set the hybrid scores 15-18%
 * hit-rate@10 with unpaid acquisitions at zero against 4-9% at 0.3, which is below a plain popularity
 * ranking. Being given something says nothing about wanting it.
 *
 * Because it is zero, both pipelines drop unpaid acquisitions in SQL rather than carrying them at zero
 * weight — same result, far less to read. The constant stays as the single place the decision is
 * recorded.
 */
export const FREE_ACQUISITION_WEIGHT = 0
/** Neighbours kept per anchor item, per source. */
export const NEIGHBORS_PER_ITEM = 50
/** A co-ownership pair needs this many co-owners before it is trusted at all. */
export const MIN_CO_OWNERS = 3
/** Shrinks the cosine towards zero for thin pairs: sim * co / (co + this). */
export const CO_OWNERSHIP_SHRINKAGE = 10
/**
 * Owners outside this band contribute nothing to co-ownership: a wallet holding one item has no pair
 * to offer, and past the ceiling a wallet correlates everything with everything.
 *
 * The ceiling counts PURCHASES, not holdings, so it is far higher than it looks: 500 bought items is a
 * serious collector rather than a bot. It was 200 when the band still counted airdrops, where real
 * collectors were being excluded by items they never chose.
 */
export const MIN_WALLET_ITEMS = 2
export const MAX_WALLET_ITEMS = 500
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

/**
 * How much each signal about a wallet is worth, relative to a purchase.
 *
 * What the avatar is wearing and what it has favourited outrank a purchase, and carry no age decay:
 * they are statements about what the wallet likes NOW, while a purchase is a statement about what it
 * liked on the day it was made. A seed — something viewed or put in the cart this session — is real
 * but weaker intent. An unpaid acquisition is worth least by a wide margin, because most of them are
 * airdrops and claims the wallet never chose.
 */
export const PROFILE_WEIGHTS = {
  paid: 1.0,
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

/**
 * Holdings fetched before the profile is assembled.
 *
 * Generous relative to MAX_PROFILE_ITEMS so the weighting in TypeScript still has something to choose
 * from, but bounded so the largest holder in production (143,832 items) does not ship its whole
 * collection over the wire. The SQL orders by the same weight formula the profile uses, so what is cut
 * is what the profile would have cut anyway.
 */
export const PROFILE_SQL_LIMIT = 400

/**
 * Creators whose recent catalogue is pulled in alongside the neighbour-driven candidates, and how many
 * items each contributes.
 *
 * Without this branch a brand-new drop from a creator the wallet collects can only surface if some
 * neighbour happens to point at it, so "More from a creator you collect" appears by luck rather than
 * by design -- and that is the reason the rail most needs to be able to give.
 */
export const TASTE_CREATOR_COUNT = 3
export const TASTE_ITEMS_PER_CREATOR = 30

/** Candidates pulled from SQL before the diversity re-rank trims to `first`. */
export const CANDIDATE_MULTIPLIER = 3

export const SUGGESTIONS_CACHE_TTL_SECONDS = 600

/**
 * Suggestion computations allowed in flight at once, past which the rail sheds instead of queueing.
 *
 * A cache MISS on this endpoint is several seconds of database work across three queries, and the
 * validation on the request parameters bounds how many DISTINCT keys a caller can invent, not how many
 * requests they can send. Without a ceiling, enough concurrent misses hold every connection in the pool
 * and every OTHER route on the service waits behind a rail the Shop treats as optional.
 *
 * Shedding returns an empty, unpersonalised rail rather than an error: the Shop already hides the rail
 * in that case, so a saturated process degrades to "no suggestions" instead of to a failed request on
 * the storefront. Cache hits are served whatever the load -- the gate sits after the cache read.
 */
export const SUGGESTIONS_MAX_CONCURRENT = 4

/** Quietest a saturated process stays between two shed-warning lines. */
export const SHED_LOG_INTERVAL_MS = 60_000

/** How often the neighbours job rebuilds the table. */
export const NEIGHBORS_REBUILD_INTERVAL_MS = 6 * 60 * 60 * 1000
/** Let a freshly deployed replica finish warming up before a multi-minute scan starts. */
export const NEIGHBORS_REBUILD_STARTUP_DELAY_MS = 5 * 60 * 1000
/** The dedicated job connections need far longer than the pool's 40s, but not unbounded. */
export const NEIGHBORS_JOB_STATEMENT_TIMEOUT_MS = 300_000
/** Past this the acquisition scan is abandoned and the previous table keeps serving. */
export const ACQUISITION_SCAN_DEADLINE_MS = 240_000
/** Rows per INSERT into the staging table. */
export const NEIGHBORS_INSERT_BATCH_SIZE = 5000

/** The only body shapes an avatar has, and so the only values worth carrying into a query or a cache
 * key. Anything else is discarded rather than passed through: an unrecognised shape filters nothing,
 * so letting it vary the key would let a caller ask for the same expensive answer under endless
 * different names. */
export const BODY_SHAPES = ['BaseMale', 'BaseFemale'] as const
export type BodyShape = (typeof BODY_SHAPES)[number]

/** Same reasoning for the category split the rail supports. */
export const SUGGESTION_CATEGORIES = ['wearable', 'emote'] as const
export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number]

export function normalizeBodyShape(value?: string): BodyShape | undefined {
  return BODY_SHAPES.find(shape => shape === value)
}

export function normalizeCategory(value?: string): SuggestionCategory | undefined {
  const lowered = value?.toLowerCase()
  return SUGGESTION_CATEGORIES.find(category => category === lowered)
}
