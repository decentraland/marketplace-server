import Cursor from 'pg-cursor'
import type { CursorClient, LoadedCatalogue } from './build-neighbors'
import { MIN_CO_WEARERS, NEIGHBORS_PER_ITEM } from './constants'
import type { NeighborInsertRow } from './neighbors-table'

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
 */
export const SELECT_CO_WORN = `WITH catalogue AS (
      SELECT unnest($1::text[]) AS item_id
    ), candidates AS (
      SELECT unnest($2::text[]) AS item_id
    ), worn AS (
      SELECT DISTINCT
             p.pointer,
             regexp_replace(lower(w), '^urn:decentraland:(?:matic|amoy):collections-v2:(0x[0-9a-f]{40}):([0-9]+)(?::[0-9]+)?$', '\\1-\\2') AS item_id
        FROM profiles p,
             jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(p.metadata -> 'avatars' -> 0 -> 'avatar' -> 'wearables') = 'array'
                    THEN p.metadata -> 'avatars' -> 0 -> 'avatar' -> 'wearables'
                    ELSE '[]'::jsonb END
             ) AS w
       -- Rejects the base wearables, over 99% of what is worn, before the regex runs
       WHERE lower(w) LIKE 'urn:decentraland:%:collections-v2:%'
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

/** Rows read per cursor fetch, and so per insert. */
const WORN_BATCH_SIZE = 20_000

/**
 * Streams the co-wear neighbours into `insert` as they arrive, so the full set never exists in memory
 * at once. Returns how many rows were written.
 */
export async function produceWornRows(
  client: CursorClient,
  catalogue: LoadedCatalogue,
  insert: (rows: NeighborInsertRow[]) => Promise<void>
): Promise<number> {
  const catalogueIds = catalogue.items.map(item => item.id)
  const candidateIds = catalogue.items.filter(item => item.isCandidate).map(item => item.id)
  const cursor = client.openCursor(new Cursor(SELECT_CO_WORN, [catalogueIds, candidateIds], { rowMode: 'array' }))

  let written = 0
  try {
    for (;;) {
      const rows: unknown[][] = await new Promise((resolve, reject) => {
        cursor.read(WORN_BATCH_SIZE, (error, batch) => (error ? reject(error) : resolve(batch)))
      })
      if (rows.length === 0) break
      await insert(
        rows.map(row => ({
          itemId: String(row[0]),
          source: 'worn',
          neighborId: String(row[1]),
          sim: Number(row[2]),
          support: Number(row[3]),
          rank: Number(row[4])
        }))
      )
      written += rows.length
    }
  } finally {
    await new Promise<void>(resolve => cursor.close(() => resolve()))
  }
  return written
}
