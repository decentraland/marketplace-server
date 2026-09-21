import SQL, { SQLStatement } from 'sql-template-strings'
import { BUILDER_SERVER_TABLE_SCHEMA, MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { CREATOR_NAME_MIN_SIMILARITY, SEARCH_QUERY_TERMS_FUNCTION, SEARCH_TOKENS_FUNCTION } from './search-normalization'

export const CREATOR_PROFILES_TABLE_NAME = 'creator_profiles'
export const CREATOR_PROFILES_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${CREATOR_PROFILES_TABLE_NAME}`
export const CREATOR_SEARCH_WORDS_TABLE_NAME = 'creator_search_words'
export const CREATOR_SEARCH_WORDS_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${CREATOR_SEARCH_WORDS_TABLE_NAME}`

/**
 * How many of a creator's NAMEs are searchable, oldest first.
 *
 * A creator is known by their profile name and, very often, by a NAME that is not it: the "atlasone" people
 * search for is a NAME owned by a profile called SWISSVERSE, "cubeman" one of fifteen owned by an unclaimed
 * profile. So NAMEs have to be in the index. But a handful of NAMEs is an identity and hundreds are stock —
 * one creator with a single item owns 3,084 of them — and indexing stock would hang every one of those
 * names on that item. Oldest first because the first names someone bought are the ones they go by; the
 * cases above all sit within the first ten.
 */
export const CREATOR_MAX_NAMES = 10

/** Addresses per Catalyst profile lookup. Sixteen calls cover every creator. */
export const CREATOR_PROFILES_BATCH_SIZE = 100

export const CREATOR_SEARCH_DEFAULT_LIMIT = 4
export const CREATOR_SEARCH_MAX_LIMIT = 10

// The same bonus an item name earns for matching the whole query, so the two rankings read alike.
const EXACT_NAME_BONUS = 1.0

// Any positive constant works; it only has to be the same in every instance of this service, and distinct
// from the keys the other rebuild jobs take.
const REFRESH_ADVISORY_LOCK_KEY = 8_421_209

/**
 * Every creator with an approved collection — the same population the Top Creators row draws from — with
 * how much they have published and the NAMEs they hold. Unapproved collections are not browsable, so
 * their creators are not findable either.
 */
export const SELECT_CREATORS = `WITH creators AS (
      SELECT item.creator AS address, COUNT(*)::int AS items
      FROM ${MARKETPLACE_SQUID_SCHEMA}.item AS item
      WHERE item.search_is_collection_approved = true
        AND item.creator IS NOT NULL
      GROUP BY item.creator
    )
    SELECT c.address, c.items, COALESCE(n.names, '{}'::text[]) AS names
    FROM creators AS c
    LEFT JOIN LATERAL (
      SELECT array_agg(ens.subdomain ORDER BY owned.created_at, ens.subdomain) AS names
      FROM (
        SELECT nft.ens_id, nft.created_at
        FROM ${MARKETPLACE_SQUID_SCHEMA}.nft AS nft
        WHERE nft.category = 'ens'
          AND nft.owner_address = c.address
        ORDER BY nft.created_at, nft.ens_id
        LIMIT ${CREATOR_MAX_NAMES}
      ) AS owned
      JOIN ${MARKETPLACE_SQUID_SCHEMA}.ens AS ens ON ens.id = owned.ens_id
      WHERE ens.subdomain IS NOT NULL
        AND ens.subdomain <> ''
    ) AS n ON true
    ORDER BY c.address`

/**
 * What every creator row is given on each refresh, whether or not their profile could be looked up: the
 * NAMEs and the item count come from the database and are always fresh. The profile columns are left
 * alone here and set by UPDATE_CREATOR_PROFILES only for the addresses Catalyst actually answered for, so
 * a failed lookup keeps the name and avatar from the last successful one rather than blanking them.
 */
export const UPSERT_CREATORS = `INSERT INTO ${CREATOR_PROFILES_TABLE} (address, names, items, updated_at)
    SELECT r.address, COALESCE(r.names, '{}'::text[]), r.items, now()
    FROM jsonb_to_recordset($1::jsonb) AS r(address text, names text[], items int)
    ON CONFLICT (address) DO UPDATE
      SET names = EXCLUDED.names, items = EXCLUDED.items, updated_at = EXCLUDED.updated_at`

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

/**
 * The profiles in a Catalyst `POST /lambdas/profiles` answer. Addresses with no profile are simply absent
 * from it, so the caller has to remember what it asked for. Anything malformed is skipped rather than
 * failing the batch: one odd profile must not cost the other ninety-nine their names.
 */
export function parseCatalystProfiles(body: unknown): CatalystProfile[] {
  if (!Array.isArray(body)) return []
  const profiles: CatalystProfile[] = []
  for (const entry of body) {
    const avatar = (entry as { avatars?: unknown[] })?.avatars?.[0] as
      | { name?: unknown; hasClaimedName?: unknown; ethAddress?: unknown; userId?: unknown; avatar?: { snapshots?: { face256?: unknown } } }
      | undefined
    const rawAddress = avatar?.ethAddress ?? avatar?.userId
    if (typeof rawAddress !== 'string' || !rawAddress) continue
    const name = typeof avatar?.name === 'string' ? avatar.name.trim() : ''
    const face = avatar?.avatar?.snapshots?.face256
    profiles.push({
      address: rawAddress.toLowerCase(),
      name: name || null,
      hasClaimedName: avatar?.hasClaimedName === true,
      face: typeof face === 'string' && face ? face : null
    })
  }
  return profiles
}

export type CreatorRow = { address: string; items: number; names: string[] }

export type RefreshClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
  release: () => void
}

export type CreatorProfilesRefreshDeps = {
  /** A client from the WRITE pool; released here when the refresh is over. */
  connect: () => Promise<RefreshClient>
  /** One Catalyst lookup. Throws when the batch fails, and the batch is then left as it was. */
  fetchProfiles: (addresses: string[]) => Promise<CatalystProfile[]>
  logger: { info: (message: string) => void; warn: (message: string) => void }
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
 * Catalyst is called per batch and a failed batch is logged and skipped: the rows keep their previous
 * name and avatar, and the next run tries again. A creator seen for the first time in a failed batch is
 * written nameless, findable by their NAMEs until then. Creators who no longer have an approved collection
 * are removed, which is what keeps the table the same population the rest of the shop shows.
 */
export async function refreshCreatorProfiles(deps: CreatorProfilesRefreshDeps): Promise<CreatorProfilesRefreshResult> {
  const { connect, fetchProfiles, logger } = deps
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
          const found = await fetchProfiles(batch)
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
        await client.query(UPSERT_CREATORS, [JSON.stringify(creators.map(({ address, names, items }) => ({ address, names, items })))])
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

export type CreatorSearchRow = { address: string; name: string; face: string | null; items: number }

/**
 * Creators whose profile name or NAMEs match every term of the query, best first.
 *
 * The same matching as the item feeds — normalized query terms against pre-split words, `<%` under the
 * trigram index, the best hit per term — over the creator words table instead of the item one. A name
 * counts when the term starts it or is most of it, never when it merely contains it, and there is no
 * relaxation: this backs a suggestion row, where a creator who matches half the query is not a suggestion.
 * Ranked by the summed similarity plus a bonus for a name that IS the query, then by how much the creator
 * has published, so a tie between two similarly named creators goes to the one with a shop to browse.
 * Shown under their profile name, or their first NAME when the profile has none.
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
      SELECT (SELECT string_agg(word, ' ' ORDER BY word) FROM unnest(${SEARCH_TOKENS_FUNCTION}(`
    )
    .append(SQL`${search}`)
    .append(
      `)) AS word) AS sorted_words
    )
    SELECT
      p.address,
      COALESCE(p.name, p.names[1]) AS name,
      p.face,
      p.items,
      (h.score + CASE WHEN EXISTS (
        SELECT 1
        FROM unnest(array_prepend(p.name, p.names)) AS n(name)
        WHERE (SELECT string_agg(word, ' ' ORDER BY word) FROM unnest(${SEARCH_TOKENS_FUNCTION}(n.name)) AS word) = q.sorted_words
      ) THEN ${EXACT_NAME_BONUS} ELSE 0 END)::float8 AS score
    FROM search_hits AS h
    JOIN ${CREATOR_PROFILES_TABLE} AS p ON p.address = h.address
    CROSS JOIN search_query AS q
    WHERE h.matched = (SELECT COUNT(*) FROM search_terms)
    ORDER BY score DESC, p.items DESC, p.address ASC
    LIMIT `
    )
    .append(SQL`${first}`)
}
