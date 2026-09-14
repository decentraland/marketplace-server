import SQL, { SQLStatement } from 'sql-template-strings'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { NEIGHBORS_TABLE, TASTE_ITEMS_PER_CREATOR } from '../../logic/suggestions/constants'
import type { ProfileEntry } from '../../logic/suggestions/profile'

const THIRTY_DAYS_IN_SECONDS = 2592000

/**
 * What the wallet holds and whether it ever paid for any of it.
 *
 * `nft` answers "holds", which is the question at request time — unlike the neighbours job, which asks
 * "acquired" and must use dated events. A resold item correctly drops out of the profile here.
 *
 * `transferred_at` is when this wallet got it; `created_at` is when the NFT was minted. The first is
 * the right age for the decay, the second the fallback for rows that never moved.
 */
export function buildOwnedQuery(address: string): SQLStatement {
  return SQL`
    SELECT
      nft.item_id::text AS item_id,
      COALESCE(nft.transferred_at, nft.created_at, 0)::bigint AS acquired_at,
      EXISTS (
        SELECT 1 FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.sale s
         WHERE lower(s.buyer) = ${address} AND s.item_id = nft.item_id
      ) OR EXISTS (
        SELECT 1 FROM `
    )
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.mint m
         WHERE lower(m.beneficiary) = ${address}
           AND m.item_id = nft.item_id
           AND COALESCE(m.search_primary_sale_price, 0) > 0
      ) AS paid
    FROM `
    )
    .append(MARKETPLACE_SQUID_SCHEMA).append(SQL`.nft nft
    WHERE lower(nft.owner_address) = ${address} AND nft.item_id IS NOT NULL`)
}

/** Attributes of the profile's own items, needed for the creator/sub-category/rarity affinities. */
export function buildProfileAttributesQuery(itemIds: string[]): SQLStatement {
  return SQL`
    SELECT
      i.id::text AS item_id,
      COALESCE(i.creator, '') AS creator,
      CASE WHEN i.item_type LIKE 'emote%' THEN 'emote' ELSE 'wearable' END
        || ':' || COALESCE(i.search_wearable_category, i.search_emote_category, '') AS sub_category,
      lower(COALESCE(i.rarity, '')) AS rarity,
      COALESCE(i.price, 0) / 1e17 AS price_credits,
      (i.item_type NOT LIKE 'emote%') AS is_wearable
    FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(SQL`.item i WHERE i.id = ANY(${itemIds}::text[])`)
}

/**
 * Candidate scores: every sellable item reachable from the wallet's profile through the precomputed
 * neighbour table, with the co-ownership and content contributions summed separately and the single
 * profile item that pulled it hardest recorded for the explanation.
 *
 * The neighbour table is only a candidate GENERATOR. What may actually be returned is decided by
 * `core`, which is `buildItemUnifiedCore` — the one definition of "credit-buyable in the Shop right
 * now" — so a neighbour that stopped being listed since the last rebuild simply does not join.
 */
export function buildCandidateScoresQuery(opts: {
  profile: ProfileEntry[]
  core: SQLStatement
  ownedItemIds: string[]
  excludeItemIds: string[]
  bodyShape?: string
  /** Lowercased creator addresses the profile shows the strongest affinity for. */
  topCreators: string[]
  limit: number
}): SQLStatement {
  const { profile, core, ownedItemIds, excludeItemIds, bodyShape, topCreators, limit } = opts

  const values = SQL``
  profile.forEach((entry, index) => {
    if (index > 0) values.append(SQL`,`)
    values.append(SQL`(${entry.itemId}, ${entry.weight}::numeric, ${entry.source})`)
  })

  const query = SQL`
    WITH profile(item_id, weight, source) AS (VALUES `
    .append(values)
    .append(
      SQL`),
    neighbours AS (
      SELECT
        n.neighbor_id AS neighbour_item_id,
        SUM(CASE WHEN n.source = 'cf' THEN p.weight * n.sim ELSE 0 END) AS cf,
        SUM(CASE WHEN n.source = 'content' THEN p.weight * n.sim ELSE 0 END) AS content,
        (array_agg(p.item_id ORDER BY p.weight * n.sim DESC))[1] AS trigger_item_id,
        (array_agg(p.source ORDER BY p.weight * n.sim DESC))[1] AS trigger_source
      FROM `
    )
    .append(NEIGHBORS_TABLE)
    .append(
      SQL` n
      JOIN profile p ON p.item_id = n.item_id
      GROUP BY n.neighbor_id
    ),
    popularity AS (
      SELECT
        COALESCE(s.item_id, s.search_contract_address || '-' || s.search_item_id::text) AS popular_item_id,
        ln(1 + count(*)::numeric) AS popularity
      FROM `
    )
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.sale s
      WHERE s.timestamp >= (extract(epoch from now())::bigint - ${THIRTY_DAYS_IN_SECONDS})
        AND (s.item_id IS NOT NULL OR s.search_item_id IS NOT NULL)
      GROUP BY 1
    ),
    core AS (`
    )
    .append(core).append(SQL`),
    scored AS (
      SELECT
        core.*,
        COALESCE(nb.cf, 0)::float8 AS cf,
        COALESCE(nb.content, 0)::float8 AS content,
        COALESCE(pop.popularity, 0)::float8 AS popularity,
        nb.trigger_item_id,
        nb.trigger_source,
        (nb.neighbour_item_id IS NOT NULL) AS from_neighbours,
        row_number() OVER (PARTITION BY lower(core.creator) ORDER BY core.created_at DESC) AS creator_rank
      FROM core
      LEFT JOIN neighbours nb ON nb.neighbour_item_id = core.contract_address || '-' || core.item_id
      LEFT JOIN popularity pop ON pop.popular_item_id = core.contract_address || '-' || core.item_id
      WHERE core.usd_wei > 0`)

  // Already-held items are the single most damaging thing a recommender can show, so the filter is a
  // parameterised array rather than an interpolated list: the owned set can run to thousands of ids.
  if (ownedItemIds.length > 0) {
    query.append(SQL` AND (core.contract_address || '-' || core.item_id) <> ALL(${ownedItemIds}::text[])`)
  }
  if (excludeItemIds.length > 0) {
    query.append(SQL` AND (core.contract_address || '-' || core.item_id) <> ALL(${excludeItemIds}::text[])`)
  }
  // An emote plays on any body, and an item that declares no shape is unisex by omission. Only a
  // wearable that explicitly declares the OTHER shape is incompatible.
  if (bodyShape === 'BaseMale' || bodyShape === 'BaseFemale') {
    const incompatible = bodyShape === 'BaseMale' ? 'female' : 'male'
    query.append(SQL` AND (core.gender IS NULL OR core.gender <> ${incompatible})`)
  }

  // Two branches, limited on their own terms. A creator-affinity candidate carries no neighbour score
  // at all, so ranking the union by that score would cut every one of them before the blend in
  // TypeScript ever saw it -- and those are exactly the rows that produce "more from a creator you
  // collect", which no neighbour list can reach for a drop nobody owns yet.
  query.append(SQL`
    )
    (
      SELECT * FROM scored
       WHERE from_neighbours
       ORDER BY (cf * 0.45 + content * 0.25) DESC, created_at DESC
       LIMIT ${limit}
    )`)

  if (topCreators.length > 0) {
    query.append(SQL`
    UNION
    (
      SELECT * FROM scored
       WHERE lower(creator) = ANY(${topCreators}::text[])
         AND creator_rank <= ${TASTE_ITEMS_PER_CREATOR}
    )`)
  }

  return query
}
