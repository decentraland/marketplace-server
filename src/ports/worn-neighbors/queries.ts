import SQL, { SQLStatement } from 'sql-template-strings'
import { MIN_CO_WEARERS, NEIGHBORS_PER_ITEM } from '../../logic/suggestions/constants'
import type { WornNeighborsCatalogue } from './types'

/**
 * Item-item co-wear neighbours, computed inside the asset-bundle-registry database, which keeps one
 * row per profile with the wearables it has on.
 *
 * Every profile counts, however long ago it was deployed. Nearly all recent deployments wear base
 * wearables only, so a recency window would keep the new accounts and drop the collectors.
 *
 * Only collections-v2 URNs match, so base wearables in either spelling (`urn:…:base-avatars:…` and
 * `dcl://base-avatars/…`) never enter a pair; the token id, when present, is dropped so every copy of
 * an item counts as that item. Anchors are any catalogued item and neighbours only candidates, the
 * same split as co-ownership. Both lists arrive as arrays and are unnested so the filters are hash
 * joins rather than a scan of a twelve-thousand element array per row.
 *
 * `sim` is the cosine `n_ab / sqrt(n_a * n_b)` and `support` the number of profiles wearing both.
 *
 * Only the two lists are bound; the rest is literal, since the profiles predicate has to read exactly
 * like the partial index's for the planner to use it.
 */
export function buildCoWornQuery({ anchorIds, candidateIds }: WornNeighborsCatalogue): SQLStatement {
  return SQL`WITH catalogue AS (
      SELECT unnest(${anchorIds}::text[]) AS item_id
    ), candidates AS (
      SELECT unnest(${candidateIds}::text[]) AS item_id
    ), `.append(CO_WORN_PAIRS)
}

const CO_WORN_PAIRS = `worn AS (
      SELECT DISTINCT
             p.pointer,
             regexp_replace(lower(w), '^urn:decentraland:(?:matic|amoy):collections-v2:(0x[0-9a-f]{40}):([0-9]+)(?::[0-9]+)?$', '\\1-\\2') AS item_id
        FROM profiles p,
             jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(p.metadata -> 'avatars' -> 0 -> 'avatar' -> 'wearables') = 'array'
                    THEN p.metadata -> 'avatars' -> 0 -> 'avatar' -> 'wearables'
                    ELSE '[]'::jsonb END
             ) AS w
       -- Matches idx_profiles_wearing_collections_v2 in asset-bundle-registry, so only the ~2% of
       -- profiles wearing a collections-v2 item are read; keep the two in step
       WHERE lower((p.metadata -> 'avatars' -> 0 -> 'avatar' -> 'wearables')::text) LIKE '%collections-v2%'
         -- Rejects the base wearables, over 99% of what is worn, before the regex runs
         AND lower(w) LIKE 'urn:decentraland:%:collections-v2:%'
         AND lower(w) ~ '^urn:decentraland:(matic|amoy):collections-v2:0x[0-9a-f]{40}:[0-9]+(:[0-9]+)?$'
    ), catalogued AS (
      SELECT worn.pointer, worn.item_id FROM worn JOIN catalogue USING (item_id)
    ), wearers AS (
      SELECT item_id, count(*) AS n FROM catalogued GROUP BY item_id
    ), pairs AS (
      SELECT a.item_id, b.item_id AS neighbor_id, count(*) AS support
        FROM catalogued a
        JOIN catalogued b ON b.pointer = a.pointer AND b.item_id <> a.item_id
        JOIN candidates c ON c.item_id = b.item_id
       GROUP BY a.item_id, b.item_id
      HAVING count(*) >= ${MIN_CO_WEARERS}
    ), scored AS (
      SELECT pairs.item_id, pairs.neighbor_id, pairs.support,
             pairs.support / sqrt(wa.n::float8 * wb.n) AS sim
        FROM pairs
        JOIN wearers wa ON wa.item_id = pairs.item_id
        JOIN wearers wb ON wb.item_id = pairs.neighbor_id
    ), ranked AS (
      SELECT scored.*, row_number() OVER (PARTITION BY item_id ORDER BY sim DESC, neighbor_id) - 1 AS rank
        FROM scored
    )
    SELECT item_id, neighbor_id, sim, support, rank
      FROM ranked
     WHERE rank < ${NEIGHBORS_PER_ITEM}
     ORDER BY item_id, rank`
