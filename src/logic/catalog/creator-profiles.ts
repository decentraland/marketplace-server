import SQL, { SQLStatement } from 'sql-template-strings'
import { BUILDER_SERVER_TABLE_SCHEMA, MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { withRetries } from '../retry'
import {
  CREATOR_NAME_MIN_SIMILARITY,
  SEARCH_PHRASE_FUNCTION,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_TERMS_FUNCTION,
  SEARCH_TOKENS_FUNCTION
} from './search-normalization'

export const CREATOR_PROFILES_TABLE_NAME = 'creator_profiles'
export const CREATOR_PROFILES_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${CREATOR_PROFILES_TABLE_NAME}`
export const CREATOR_SEARCH_WORDS_TABLE_NAME = 'creator_search_words'
export const CREATOR_SEARCH_WORDS_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${CREATOR_SEARCH_WORDS_TABLE_NAME}`
export const CREATOR_SEARCH_NAMES_TABLE_NAME = 'creator_search_names'
export const CREATOR_SEARCH_NAMES_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${CREATOR_SEARCH_NAMES_TABLE_NAME}`

/**
 * How many of a creator's NAMEs their ITEMS inherit as search words.
 *
 * A creator is known by their profile name and, very often, by a NAME that is not it: the "atlasone" people
 * search for is a NAME owned by a profile called SWISSVERSE, "cubeman" one of fifteen owned by an unclaimed
 * profile. So NAMEs have to be in the index — all of them, for the creator suggestions, where a NAME that
 * is the query must find its holder however many they own. But a handful of NAMEs is an identity and
 * hundreds are stock — one creator with a single item owns 3,084 of them — and hanging every one of those
 * on the creator's items would attach that item to three thousand words. So the items take only this many,
 * in order of the NAME's minting date: not when this creator got it, which the squid does not record, but
 * the best proxy there is, and the cases above all sit within the first ten.
 */
export const CREATOR_MAX_NAMES = 10

/** Addresses per Catalyst profile lookup. Sixteen calls cover every creator. */
export const CREATOR_PROFILES_BATCH_SIZE = 100
/** A batch that fails is tried again after these waits before it is given up on for this run. */
export const CREATOR_PROFILES_BATCH_RETRY_DELAYS_MS = [1_000, 4_000]
export const CREATOR_SEARCH_MAX_LENGTH = SEARCH_QUERY_MAX_LENGTH

export const CREATOR_SEARCH_DEFAULT_LIMIT = 4
export const CREATOR_SEARCH_MAX_LIMIT = 10

// The same bonuses an item name earns, so the two rankings read alike: a name that IS the query heads the
// list whatever the terms weigh, and a name that STARTS with it goes above one that merely contains it.
const EXACT_NAME_BONUS = 1.0
const NAME_PREFIX_BONUS = 0.5

// Any positive constant works; it only has to be the same in every instance of this service, and distinct
// from the keys the other rebuild jobs take.
const REFRESH_ADVISORY_LOCK_KEY = 8_421_209

/**
 * Every creator with an approved collection — the same population the Top Creators row draws from,
 * attributed by `item.creator`, never by who sells — with how much they have published and every NAME
 * they hold, oldest minted first. Unapproved collections are not browsable, so their creators are not
 * findable either.
 */
export const SELECT_CREATORS = `WITH creators AS (
      SELECT item.creator AS address, COUNT(*)::int AS items, COUNT(DISTINCT item.collection_id)::int AS collections
      FROM ${MARKETPLACE_SQUID_SCHEMA}.item AS item
      WHERE item.search_is_collection_approved = true
        AND item.creator IS NOT NULL
      GROUP BY item.creator
    )
    SELECT c.address, c.items, c.collections, COALESCE(n.names, '{}'::text[]) AS names
    FROM creators AS c
    LEFT JOIN LATERAL (
      SELECT array_agg(ens.subdomain ORDER BY nft.created_at, ens.subdomain) AS names
      FROM ${MARKETPLACE_SQUID_SCHEMA}.nft AS nft
      JOIN ${MARKETPLACE_SQUID_SCHEMA}.ens AS ens ON ens.id = nft.ens_id
      WHERE nft.category = 'ens'
        AND nft.owner_address = c.address
        AND ens.subdomain IS NOT NULL
        AND ens.subdomain <> ''
    ) AS n ON true
    ORDER BY c.address`

/**
 * What every creator row is given on each refresh, whether or not their profile could be looked up: the
 * NAMEs and the item count come from the database and are always fresh. The profile columns are left
 * alone here and set by UPDATE_CREATOR_PROFILES only for the addresses Catalyst actually answered for, so
 * a failed lookup keeps the name and avatar from the last successful one rather than blanking them.
 */
export const UPSERT_CREATORS = `INSERT INTO ${CREATOR_PROFILES_TABLE} (address, names, items, collections, updated_at)
    SELECT r.address, COALESCE(r.names, '{}'::text[]), r.items, r.collections, now()
    FROM jsonb_to_recordset($1::jsonb) AS r(address text, names text[], items int, collections int)
    ON CONFLICT (address) DO UPDATE
      SET names = EXCLUDED.names, items = EXCLUDED.items, collections = EXCLUDED.collections, updated_at = EXCLUDED.updated_at`

export const UPDATE_CREATOR_PROFILES = `UPDATE ${CREATOR_PROFILES_TABLE} AS p
    SET name = r.name, has_claimed_name = r.has_claimed_name, face = r.face
    FROM jsonb_to_recordset($1::jsonb) AS r(address text, name text, has_claimed_name boolean, face text)
    WHERE p.address = r.address`

export const DELETE_STALE_CREATORS = `DELETE FROM ${CREATOR_PROFILES_TABLE} WHERE address <> ALL($1::text[])`

export type CatalystProfile = {
  address: string
  name: string | null
  hasClaimedName: boolean
  face: string | null
}

/** A Catalyst answer that is not the shape a profiles answer has. The batch it came for is kept as it was. */
export class CatalystPayloadError extends Error {
  constructor(reason: string) {
    super(`Unexpected Catalyst profiles payload: ${reason}`)
  }
}

/**
 * The profiles in a Catalyst `POST /lambdas/profiles` answer. Addresses with no profile are simply absent
 * from it, so the caller has to remember what it asked for — that absence is the one VALID way to learn a
 * profile is gone. Anything else that is not the documented shape — a body that is not a list, an entry
 * without an avatar, an avatar without an address — throws, and the whole batch counts as failed: an
 * HTTP 200 carrying an error object must keep every name in the batch, not blank it.
 */
export function parseCatalystProfiles(body: unknown): CatalystProfile[] {
  if (!Array.isArray(body)) throw new CatalystPayloadError('the body is not a list')
  return body.map((entry, index) => {
    const avatars = (entry as { avatars?: unknown } | null)?.avatars
    if (!Array.isArray(avatars) || avatars.length === 0) throw new CatalystPayloadError(`entry ${index} has no avatar`)
    const avatar = avatars[0] as {
      name?: unknown
      hasClaimedName?: unknown
      ethAddress?: unknown
      userId?: unknown
      avatar?: { snapshots?: { face256?: unknown } }
    }
    const rawAddress = avatar?.ethAddress ?? avatar?.userId
    if (typeof rawAddress !== 'string' || !rawAddress) throw new CatalystPayloadError(`entry ${index} has no address`)
    const name = typeof avatar.name === 'string' ? avatar.name.trim() : ''
    const face = avatar.avatar?.snapshots?.face256
    return {
      address: rawAddress.toLowerCase(),
      name: name || null,
      hasClaimedName: avatar.hasClaimedName === true,
      face: typeof face === 'string' && face ? face : null
    }
  })
}

export type CreatorRow = { address: string; items: number; collections: number; names: string[] }

export type RefreshClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
  release: () => void
}

export type CreatorProfilesRefreshDeps = {
  /** A client from the WRITE pool; released here when the refresh is over. */
  connect: () => Promise<RefreshClient>
  /** One Catalyst lookup. Throws when the batch fails or answers nonsense; it is retried, then left as it was for this run. */
  fetchProfiles: (addresses: string[]) => Promise<CatalystProfile[]>
  logger: { info: (message: string) => void; warn: (message: string) => void }
  /** Injected by tests so the retry schedule is not waited out. */
  sleep?: (ms: number) => Promise<void>
}

export type CreatorProfilesRefreshResult =
  | { outcome: 'skipped' }
  | { outcome: 'refreshed'; creators: number; lookedUp: number; failedBatches: number }

/**
 * Brings `creator_profiles` up to date: who the creators are, how much they have published, which NAMEs
 * they hold, and — from Catalyst — what they are called and what they look like.
 *
 * Every replica runs this on the same schedule, so the first thing it does is take a SESSION advisory
 * lock and step aside if another replica holds it; the lock spans the Catalyst calls, so the losers do
 * not spend sixteen requests on an answer they would throw away. Nothing here runs inside a request.
 *
 * Catalyst is called per batch; a batch that fails is retried with a short backoff and then skipped for
 * this run, logged: those rows keep their previous name and avatar, and the next run tries again. A
 * creator seen for the first time in a failed batch is written nameless, findable by their NAMEs until
 * then. A batch that ANSWERS is the truth for every address in it — matched by address, never by position
 * — so an address Catalyst no longer knows is written nameless rather than keeping a stale name for ever.
 * Creators who no longer have an approved collection are removed, decided from the full creator list the
 * database returned, never from what Catalyst did or did not answer.
 */
export async function refreshCreatorProfiles(deps: CreatorProfilesRefreshDeps): Promise<CreatorProfilesRefreshResult> {
  const { connect, fetchProfiles, logger, sleep } = deps
  const client = await connect()
  try {
    const { rows } = await client.query(`SELECT pg_try_advisory_lock(${REFRESH_ADVISORY_LOCK_KEY}) AS acquired`)
    if (!rows[0]?.acquired) {
      logger.info('Creator profiles are being refreshed by another instance')
      return { outcome: 'skipped' }
    }
    try {
      const creators = (await client.query(SELECT_CREATORS)).rows as CreatorRow[]
      // Absent: not looked up this run. Null: looked up, Catalyst has no profile for it.
      const profiles = new Map<string, CatalystProfile | null>()
      let failedBatches = 0
      for (let i = 0; i < creators.length; i += CREATOR_PROFILES_BATCH_SIZE) {
        const batch = creators.slice(i, i + CREATOR_PROFILES_BATCH_SIZE).map(creator => creator.address)
        try {
          const found = await withRetries(() => fetchProfiles(batch), CREATOR_PROFILES_BATCH_RETRY_DELAYS_MS, {
            sleep,
            onRetry: (error, delayMs) =>
              logger.warn(
                `A creator profile lookup failed, trying again in ${delayMs} ms: ${error instanceof Error ? error.message : String(error)}`
              )
          })
          for (const address of batch) profiles.set(address, null)
          for (const profile of found) if (profiles.has(profile.address)) profiles.set(profile.address, profile)
        } catch (error) {
          failedBatches += 1
          logger.warn(
            `Could not look up ${batch.length} creator profiles, keeping their previous names: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        }
      }

      const lookedUp = creators.filter(creator => profiles.has(creator.address))
      await client.query('BEGIN')
      try {
        await client.query(UPSERT_CREATORS, [
          JSON.stringify(creators.map(({ address, names, items, collections }) => ({ address, names, items, collections })))
        ])
        if (lookedUp.length > 0) {
          await client.query(UPDATE_CREATOR_PROFILES, [
            JSON.stringify(
              lookedUp.map(({ address }) => {
                const profile = profiles.get(address)
                return {
                  address,
                  name: profile?.name ?? null,
                  has_claimed_name: profile?.hasClaimedName ?? false,
                  face: profile?.face ?? null
                }
              })
            )
          ])
        }
        await client.query(DELETE_STALE_CREATORS, [creators.map(creator => creator.address)])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
      return { outcome: 'refreshed', creators: creators.length, lookedUp: lookedUp.length, failedBatches }
    } finally {
      await client.query(`SELECT pg_advisory_unlock(${REFRESH_ADVISORY_LOCK_KEY})`).catch(() => undefined)
    }
  } finally {
    client.release()
  }
}

/** What to call a creator on a row about their work: the profile name, or the first NAME, or nothing. */
export function getCreatorDisplayNamesQuery(addresses: string[]): SQLStatement {
  return SQL``
    .append(`SELECT address, COALESCE(name, names[1]) AS name FROM ${CREATOR_PROFILES_TABLE} WHERE address = ANY(`)
    .append(SQL`${addresses}`)
    .append(')')
}

export type CreatorSearchRow = { address: string; name: string; face: string | null; items: number; collections: number }

/**
 * Creators whose profile name or NAMEs match every term of the query, best first.
 *
 * The same matching as the item feeds — normalized query terms against pre-split words, `<%` under the
 * trigram index, the best hit per term, every term required and, only when nothing matches them all, the
 * creators that match the most — over the creator words table instead of the item one. A name counts
 * when the term starts it or is most of it, never when it merely contains it.
 *
 * Ranked by the summed similarity plus the item feeds' bonuses — a profile name or NAME that IS the query,
 * then one that STARTS with it — so exact beats prefix beats partial by construction rather than by luck
 * of the weights; then by how much the creator has published, so a tie between two similarly named
 * creators goes to the one with a shop to browse; then by name and address, so pages are stable. Shown
 * under the profile name, or the first NAME when the profile has none, or the address when it has neither.
 *
 * The bonuses read the names' precomputed phrase and sorted words rather than normalizing each name here:
 * one creator holds three thousand NAMEs, and a three-letter query that reached them cost fifty
 * milliseconds normalizing every one of them on every keystroke.
 */
export function getCreatorSearchQuery(search: string, first: number): SQLStatement {
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
      SELECT w.address, t.term, MAX(word_similarity(t.term, w.word))::float8 AS best
      FROM ${CREATOR_SEARCH_WORDS_TABLE} AS w
      JOIN search_terms AS t
        ON t.term <% w.word
       AND (starts_with(w.word, t.term) OR similarity(t.term, w.word) >= ${CREATOR_NAME_MIN_SIMILARITY})
      GROUP BY w.address, t.term
    ), search_hits AS (
      SELECT address, COUNT(*)::int AS matched, SUM(best)::float8 AS score
      FROM search_term_hits
      GROUP BY address
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
      p.address,
      COALESCE(p.name, p.names[1], p.address) AS name,
      p.face,
      p.items,
      p.collections,
      (h.score + CASE
        WHEN EXISTS (
          SELECT 1 FROM ${CREATOR_SEARCH_NAMES_TABLE} AS n
          WHERE n.address = p.address
            AND n.sorted_words = q.sorted_words
        ) THEN ${EXACT_NAME_BONUS}
        WHEN EXISTS (
          SELECT 1 FROM ${CREATOR_SEARCH_NAMES_TABLE} AS n
          WHERE n.address = p.address
            AND starts_with(n.phrase, q.phrase)
        ) THEN ${NAME_PREFIX_BONUS}
        ELSE 0
      END)::float8 AS score
    FROM search_hits AS h
    JOIN ${CREATOR_PROFILES_TABLE} AS p ON p.address = h.address
    CROSS JOIN search_query AS q
    WHERE h.matched = (SELECT MAX(matched) FROM search_hits)
    ORDER BY score DESC, p.items DESC, COALESCE(p.name, p.names[1], p.address) ASC, p.address ASC
    LIMIT `
    )
    .append(SQL`${first}`)
}
