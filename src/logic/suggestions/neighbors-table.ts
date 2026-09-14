import { BUILDER_SERVER_TABLE_SCHEMA, MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import {
  ALGORITHM_VERSION,
  MAX_WALLET_ITEMS,
  MIN_WALLET_ITEMS,
  NEIGHBORS_ITEM_INDEX,
  NEIGHBORS_META_TABLE,
  NEIGHBORS_TABLE,
  NEIGHBORS_TABLE_NAME
} from './constants'

const STAGING_TABLE_NAME = `${NEIGHBORS_TABLE_NAME}_staging`
const STAGING_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${STAGING_TABLE_NAME}`
const STAGING_ITEM_INDEX = `${NEIGHBORS_ITEM_INDEX}_staging`

/** Any positive constant works; it only has to be the same in every instance of this service. */
const REBUILD_ADVISORY_LOCK_KEY = 8_421_311

export const CREATE_NEIGHBORS_TABLE = `CREATE TABLE IF NOT EXISTS ${NEIGHBORS_TABLE} (
    item_id text NOT NULL,
    source text NOT NULL,
    neighbor_id text NOT NULL,
    sim real NOT NULL,
    support integer NOT NULL DEFAULT 0,
    rank smallint NOT NULL,
    PRIMARY KEY (item_id, source, neighbor_id)
  )`
export const CREATE_NEIGHBORS_ITEM_INDEX = `CREATE INDEX IF NOT EXISTS ${NEIGHBORS_ITEM_INDEX} ON ${NEIGHBORS_TABLE} (item_id)`
export const DROP_NEIGHBORS_TABLE = `DROP TABLE IF EXISTS ${NEIGHBORS_TABLE}`

/** Named separately because the CHECK constraint name has to be stable across migrations. */
// eslint-disable-next-line @typescript-eslint/naming-convention
const NEIGHBORS_META_TABLE_SINGLETON = 'item_neighbors_meta_singleton'

/**
 * One row, rewritten by every successful rebuild. It exists so "the job stopped running" is a query
 * rather than a log search: `built_at` going stale is the alertable condition.
 */
export const CREATE_NEIGHBORS_META_TABLE = `CREATE TABLE IF NOT EXISTS ${NEIGHBORS_META_TABLE} (
    id boolean PRIMARY KEY DEFAULT true,
    built_at timestamptz NOT NULL,
    duration_ms integer NOT NULL,
    cf_rows integer NOT NULL,
    content_rows integer NOT NULL,
    items_covered integer NOT NULL,
    algorithm text NOT NULL,
    CONSTRAINT ${NEIGHBORS_META_TABLE_SINGLETON} CHECK (id)
  )`
export const DROP_NEIGHBORS_META_TABLE = `DROP TABLE IF EXISTS ${NEIGHBORS_META_TABLE}`

/**
 * Every (wallet, item) acquisition, collapsed to one row carrying whether the wallet ever paid for it.
 *
 * Dated events, never `nft.owner_address`: the current owner tells you nothing about who acquired what,
 * and a resold item would be credited to the wrong wallet. `mint.search_primary_sale_price` null or 0 is
 * a free claim or airdrop — `sale` has no zero-price rows, because free mints never produce a sale.
 *
 * The owner band drops one-item wallets (no co-occurrence to contribute) and 200+ item wallets, which
 * are bots and marketplace accounts whose holdings correlate everything with everything.
 */
export const SELECT_ACQUISITIONS = `WITH acquisitions AS (
      SELECT lower(beneficiary) AS wallet, item_id, (COALESCE(search_primary_sale_price, 0) > 0) AS paid
        FROM ${MARKETPLACE_SQUID_SCHEMA}.mint
       WHERE beneficiary IS NOT NULL AND item_id IS NOT NULL
      UNION ALL
      SELECT lower(buyer) AS wallet,
             COALESCE(item_id, search_contract_address || '-' || search_item_id::text) AS item_id,
             true AS paid
        FROM ${MARKETPLACE_SQUID_SCHEMA}.sale
       WHERE buyer IS NOT NULL AND (item_id IS NOT NULL OR search_item_id IS NOT NULL)
    ), pairs AS (
      SELECT wallet, item_id, bool_or(paid) AS paid
        FROM acquisitions
       GROUP BY wallet, item_id
    ), band AS (
      SELECT wallet
        FROM pairs
       GROUP BY wallet
      HAVING count(*) BETWEEN ${MIN_WALLET_ITEMS} AND ${MAX_WALLET_ITEMS}
    )
    SELECT p.wallet, p.item_id, p.paid
      FROM pairs p
      JOIN band b ON b.wallet = p.wallet
     ORDER BY p.wallet`

/**
 * The item attributes the content pass needs, plus the candidacy flag.
 *
 * `is_candidate` is deliberately BROADER than "sellable in the Shop right now": it is every approved,
 * non-social item. The request-time query joins against `buildItemUnifiedCore`, which is the one
 * definition of sellable, so narrowing here would only mean an item that gets listed between two job
 * runs has no neighbour rows and stays invisible for up to six hours. Listing state changes constantly;
 * approval does not.
 */
export const SELECT_ITEMS = `SELECT
      id::text AS item_id,
      COALESCE(creator, '') AS creator,
      COALESCE(collection_id, '') AS collection_id,
      CASE WHEN item_type LIKE 'emote%' THEN 'emote' ELSE 'wearable' END
        || ':' || COALESCE(search_wearable_category, search_emote_category, '') AS sub_category,
      COALESCE(rarity, '') AS rarity,
      COALESCE(price, 0) / 1e18 AS price,
      (search_is_collection_approved = true AND search_emote_outcome_type IS NULL) AS is_candidate
    FROM ${MARKETPLACE_SQUID_SCHEMA}.item`

export const SELECT_TAGS = `SELECT item_id, lower(tag) AS tag
    FROM ${BUILDER_SERVER_TABLE_SCHEMA}.mv_builder_server_items
   WHERE tag IS NOT NULL AND tag <> ''`

export type NeighborsMeta = {
  cfRows: number
  contentRows: number
  itemsCovered: number
  durationMs: number
}

export type RebuildOutcome = 'rebuilt' | 'skipped'

export type QueryableClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
}

/**
 * Swaps a freshly computed neighbour set in.
 *
 * Mirrors rebuildItemSearchWords: one transaction, the live table untouched until the drop-and-rename
 * at the end, so a failure (including the pool's statement timeout) rolls back and leaves the previous
 * neighbours serving. Readers block only for the rename.
 *
 * The advisory lock is not optional — every ECS replica runs the job on the same schedule, and three
 * replicas recomputing 700k rows simultaneously is both wasted work and three writers racing for the
 * same table name.
 */
export async function swapNeighborsTable(
  client: QueryableClient,
  rows: Array<{ itemId: string; source: string; neighborId: string; sim: number; support: number; rank: number }>,
  meta: NeighborsMeta
): Promise<RebuildOutcome> {
  await client.query('BEGIN')
  try {
    const { rows: lockRows } = await client.query(`SELECT pg_try_advisory_xact_lock(${REBUILD_ADVISORY_LOCK_KEY}) AS acquired`)
    if (!lockRows[0]?.acquired) {
      await client.query('ROLLBACK')
      return 'skipped'
    }

    await client.query(`DROP TABLE IF EXISTS ${STAGING_TABLE}`)
    await client.query(`CREATE TABLE ${STAGING_TABLE} (LIKE ${NEIGHBORS_TABLE} INCLUDING DEFAULTS)`)

    await insertInBatches(client, rows)

    await client.query(`CREATE INDEX ${STAGING_ITEM_INDEX} ON ${STAGING_TABLE} (item_id)`)
    await client.query(`ANALYZE ${STAGING_TABLE}`)

    await client.query(DROP_NEIGHBORS_TABLE)
    await client.query(`ALTER TABLE ${STAGING_TABLE} RENAME TO ${NEIGHBORS_TABLE_NAME}`)
    await client.query(`ALTER INDEX ${BUILDER_SERVER_TABLE_SCHEMA}.${STAGING_ITEM_INDEX} RENAME TO ${NEIGHBORS_ITEM_INDEX}`)

    await client.query(
      `INSERT INTO ${NEIGHBORS_META_TABLE} (id, built_at, duration_ms, cf_rows, content_rows, items_covered, algorithm)
       VALUES (true, now(), $1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         built_at = EXCLUDED.built_at,
         duration_ms = EXCLUDED.duration_ms,
         cf_rows = EXCLUDED.cf_rows,
         content_rows = EXCLUDED.content_rows,
         items_covered = EXCLUDED.items_covered,
         algorithm = EXCLUDED.algorithm`,
      [meta.durationMs, meta.cfRows, meta.contentRows, meta.itemsCovered, ALGORITHM_VERSION]
    )

    await client.query('COMMIT')
    return 'rebuilt'
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

/** Rows per multi-value INSERT. Six parameters each, so this stays well inside Postgres' 65535 limit. */
const INSERT_BATCH_SIZE = 2000

async function insertInBatches(
  client: QueryableClient,
  rows: Array<{ itemId: string; source: string; neighborId: string; sim: number; support: number; rank: number }>
): Promise<void> {
  for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
    const batch = rows.slice(start, start + INSERT_BATCH_SIZE)
    const values: unknown[] = []
    const placeholders = batch
      .map((row, i) => {
        values.push(row.itemId, row.source, row.neighborId, row.sim, row.support, row.rank)
        const base = i * 6
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
      })
      .join(',')
    await client.query(
      `INSERT INTO ${STAGING_TABLE} (item_id, source, neighbor_id, sim, support, rank) VALUES ${placeholders}
       ON CONFLICT (item_id, source, neighbor_id) DO NOTHING`,
      values
    )
  }
}
