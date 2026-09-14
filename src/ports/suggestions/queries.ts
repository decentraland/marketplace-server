import SQL, { SQLStatement } from 'sql-template-strings'
import { MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import { FREE_ACQUISITION_WEIGHT, NEIGHBORS_TABLE, RECENCY_DECAY_DAYS, TASTE_ITEMS_PER_CREATOR } from '../../logic/suggestions/constants'
import type { ProfileEntry } from '../../logic/suggestions/profile'

const THIRTY_DAYS_IN_SECONDS = 2592000

/**
 * What the wallet holds, strongest taste signal first.
 *
 * `nft` answers "holds", which is the question at request time — unlike the neighbours job, which asks
 * "acquired" and must use dated events. A resold item correctly drops out of the profile here.
 *
 * Three things this query is careful about, each measured against production:
 *
 * - **No `lower()` on `owner_address`.** Addresses are stored lowercased (zero rows differ), and
 *   wrapping the column makes `IDX_26e756121a20d1cc3e4d738279` unusable: the same lookup goes from a
 *   1 ms index scan to a 4.3 s parallel sequential scan over 5.3M rows.
 * - **"Paid" comes from `sale` alone.** The obvious second source is a primary mint with a non-zero
 *   sale price, but `mint.beneficiary` carries a `-POLYGON`/`-ETHEREUM` suffix and has no index, so
 *   joining it costs a 2.1 s sequential scan. It is also nearly redundant: of the paid mints in the
 *   last 180 days, 97.9% already have a matching `sale` row. The remaining 2% land at the unpaid
 *   weight, which is a far better trade than two seconds on every request.
 * - **The weight is computed here and the row count capped**, so a wallet holding six figures of items
 *   does not ship all of them to the client. The cap is generous relative to what the profile keeps;
 *   deliberate signals (equipped, favourites, seeds) are added outside this query, so their priority
 *   is unaffected by it.
 *
 * `transferred_at` is when this wallet got it; `created_at` is when the NFT was minted. The first is
 * the right age for the decay, the second the fallback for rows that never moved.
 */
export function buildOwnedQuery(address: string, limit: number): SQLStatement {
  return SQL`
    WITH owned AS (
      SELECT n.item_id::text AS item_id, COALESCE(n.transferred_at, n.created_at, 0)::bigint AS acquired_at
        FROM `
    .append(MARKETPLACE_SQUID_SCHEMA)
    .append(
      SQL`.nft n
       WHERE n.owner_address = ${address} AND n.item_id IS NOT NULL
    ), paid AS (
      SELECT DISTINCT o.item_id
        FROM owned o
        JOIN `
    )
    .append(MARKETPLACE_SQUID_SCHEMA).append(SQL`.sale s ON s.item_id = o.item_id AND s.buyer = ${address}
    )
    SELECT o.item_id, o.acquired_at, (p.item_id IS NOT NULL) AS paid
      FROM owned o
      LEFT JOIN paid p ON p.item_id = o.item_id
     ORDER BY (CASE WHEN p.item_id IS NOT NULL THEN 1.0 ELSE ${FREE_ACQUISITION_WEIGHT} END)
              * exp(-GREATEST(0, (extract(epoch from now())::bigint - o.acquired_at)) / 86400.0 / ${RECENCY_DECAY_DAYS}::numeric) DESC
     LIMIT ${limit}`)
}

/** Attributes of the profile's own items, needed for the creator/sub-category/rarity affinities. */
export function buildProfileAttributesQuery(itemIds: string[], manaUsdRate: number): SQLStatement {
  return SQL`
    SELECT
      i.id::text AS item_id,
      COALESCE(i.creator, '') AS creator,
      CASE WHEN i.item_type LIKE 'emote%' THEN 'emote' ELSE 'wearable' END
        || ':' || COALESCE(i.search_wearable_category, i.search_emote_category, '') AS sub_category,
      lower(COALESCE(i.rarity, '')) AS rarity,
      -- The item's MANA price converted the same way the catalogue converts it: MANA -> USD at the
      -- live rate, USD -> credits at 10 per dollar. Dividing by a fixed 1e17 (the old form here) is
      -- only correct when 1 MANA happens to be worth exactly 1 USD, so the price band compared a
      -- MANA-denominated profile against USD-denominated candidates.
      (COALESCE(i.price, 0) / 1e18) * ${manaUsdRate} * 10 AS price_credits,
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
  /** Lowercased wallet whose holdings are excluded. Absent for a seeds-only caller, who owns nothing
   * we know about. */
  address?: string
  excludeItemIds: string[]
  bodyShape?: string
  /** Lowercased creator addresses the profile shows the strongest affinity for. */
  topCreators: string[]
  limit: number
}): SQLStatement {
  const { profile, core, address, excludeItemIds, bodyShape, topCreators, limit } = opts

  const values = SQL``
  profile.forEach((entry, index) => {
    if (index > 0) values.append(SQL`,`)
    values.append(SQL`(${entry.itemId}, ${entry.weight}::numeric, ${entry.source})`)
  })

  const query = SQL`
    WITH `
  if (address) {
    // MATERIALIZED on purpose. Left to itself Postgres inlines this and re-probes `nft` once per
    // candidate, which on the largest holder in production (143,832 items) takes 4.1 s; passing the
    // same ids back as an array and testing `<> ALL` takes 14.8 s. Building the set once through the
    // owner index and hash-anti-joining against it takes 192 ms.
    query
      .append(
        SQL`owned AS MATERIALIZED (
      SELECT n.item_id::text AS item_id FROM `
      )
      .append(MARKETPLACE_SQUID_SCHEMA).append(SQL`.nft n
       WHERE n.owner_address = ${address} AND n.item_id IS NOT NULL
    ),
    `)
  }
  query
    .append(SQL`profile(item_id, weight, source) AS (VALUES `)
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

  // Showing someone what they already own is the single most damaging thing this rail can do, so the
  // exclusion covers EVERY holding rather than the subset the profile kept.
  if (address) {
    query.append(SQL` AND NOT EXISTS (SELECT 1 FROM owned o WHERE o.item_id = core.contract_address || '-' || core.item_id)`)
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
