import { BUILDER_SERVER_TABLE_SCHEMA, MARKETPLACE_SQUID_SCHEMA } from '../../constants'
import {
  ALGORITHM_VERSION,
  MAX_WALLET_ITEMS,
  MIN_WALLET_ITEMS,
  NEIGHBORS_ITEM_INDEX,
  NEIGHBORS_META_TABLE,
  NEIGHBORS_INSERT_BATCH_SIZE,
  NEIGHBORS_TABLE,
  NEIGHBORS_TABLE_NAME
} from './constants'

const STAGING_TABLE_NAME = `${NEIGHBORS_TABLE_NAME}_staging`
const STAGING_TABLE = `${BUILDER_SERVER_TABLE_SCHEMA}.${STAGING_TABLE_NAME}`
const STAGING_ITEM_INDEX = `${NEIGHBORS_ITEM_INDEX}_staging`
const NEIGHBORS_PRIMARY_KEY = `${NEIGHBORS_TABLE_NAME}_pkey`
const STAGING_PRIMARY_KEY = `${STAGING_TABLE_NAME}_pkey`

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
 * Every (wallet, item) PURCHASE, one row each.
 *
 * Dated events, never `nft.owner_address`: the current owner tells you nothing about who acquired
 * what, and a resold item would be credited to the wrong wallet.
 *
 * Only paid acquisitions. Unpaid ones — airdrops, free claims, gifts — were carried at a discount
 * until an offline evaluation showed they drag the hybrid below a plain popularity ranking: read as
 * one person, a wallet has five to fifteen of them per purchase, and they pull the co-ownership
 * vectors towards whatever was mass-distributed. Dropping them here rather than weighting them at
 * zero also takes ~70% of the mint table out of the scan and the pair set from ~2M to ~150k.
 *
 * `mint.beneficiary` is NOT a bare address: it is `<address>-POLYGON` or `<address>-ETHEREUM`, while
 * `sale.buyer` is the address alone. Lowercasing the two and calling it a day splits every person who
 * both minted and bought into two separate owners, which is exactly the co-occurrence this table is
 * built to find — the suffix has to come off. Both columns are already lowercase (verified against
 * production), so nothing else is needed.
 */
export const SELECT_ACQUISITIONS = `WITH acquisitions AS (
      SELECT split_part(beneficiary, '-', 1) AS wallet, item_id
        FROM ${MARKETPLACE_SQUID_SCHEMA}.mint
       WHERE beneficiary IS NOT NULL
         AND item_id IS NOT NULL
         AND COALESCE(search_primary_sale_price, 0) > 0
      UNION ALL
      SELECT buyer AS wallet,
             COALESCE(item_id, search_contract_address || '-' || search_item_id::text) AS item_id
        FROM ${MARKETPLACE_SQUID_SCHEMA}.sale
       WHERE buyer IS NOT NULL AND (item_id IS NOT NULL OR search_item_id IS NOT NULL)
    ), pairs AS (
      SELECT wallet, item_id FROM acquisitions GROUP BY wallet, item_id
    ), band AS (
      SELECT wallet
        FROM pairs
       GROUP BY wallet
      HAVING count(*) BETWEEN ${MIN_WALLET_ITEMS} AND ${MAX_WALLET_ITEMS}
    )
    SELECT p.wallet, p.item_id
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
 * Mirrors rebuildSearchTables: one transaction, the live table untouched until the drop-and-rename
 * at the end, so a failure (including the pool's statement timeout) rolls back and leaves the previous
 * neighbours serving. Readers block only for the rename.
 *
 * The advisory lock is not optional — every ECS replica runs the job on the same schedule, and three
 * replicas recomputing 700k rows simultaneously is both wasted work and three writers racing for the
 * same table name.
 */
export type NeighborInsertRow = {
  itemId: string
  source: string
  neighborId: string
  sim: number
  support: number
  rank: number
}

/**
 * Produces the rows to write, handing each chunk to `insert` as it is generated and returning what to
 * record in the metadata row.
 *
 * A callback rather than an array because the two generators together produce ~940k rows: materialising
 * them all, then materialising the insert form of them all, was the single largest thing in the job's
 * memory profile. Feeding them through in chunks lets each generator's output be released before the
 * next one runs.
 */
export type NeighborProducer = (insert: (rows: NeighborInsertRow[]) => Promise<void>) => Promise<NeighborsMeta>

/**
 * Swaps a freshly computed neighbour set in.
 *
 * Mirrors rebuildSearchTables: one transaction, the live table untouched until the drop-and-rename
 * at the end, so a failure (including a statement timeout) rolls back and leaves the previous
 * neighbours serving. Readers block only for the rename.
 *
 * The advisory lock is not optional — every ECS replica runs the job on the same schedule, and three
 * replicas recomputing 940k rows simultaneously is both wasted work and three writers racing for the
 * same table name.
 */
export async function swapNeighborsTable(client: QueryableClient, produce: NeighborProducer): Promise<RebuildOutcome> {
  await client.query('BEGIN')
  try {
    const { rows: lockRows } = await client.query(`SELECT pg_try_advisory_xact_lock(${REBUILD_ADVISORY_LOCK_KEY}) AS acquired`)
    if (!lockRows[0]?.acquired) {
      await client.query('ROLLBACK')
      return 'skipped'
    }

    await client.query(`DROP TABLE IF EXISTS ${STAGING_TABLE}`)
    // `LIKE` copies columns and defaults but NOT the primary key -- that needs INCLUDING INDEXES, which
    // would also copy the secondary index under a generated name this code could not rename afterwards.
    // So the key is added explicitly below, after the rows are in: building it once over a full table is
    // cheaper than maintaining it across ~940k inserts, and a duplicate row would fail the whole swap
    // rather than being silently dropped, which is the right outcome for what would be a generator bug.
    await client.query(`CREATE TABLE ${STAGING_TABLE} (LIKE ${NEIGHBORS_TABLE} INCLUDING DEFAULTS)`)

    const meta = await produce(rows => insertInBatches(client, rows))

    await client.query(`ALTER TABLE ${STAGING_TABLE} ADD CONSTRAINT ${STAGING_PRIMARY_KEY} PRIMARY KEY (item_id, source, neighbor_id)`)
    await client.query(`CREATE INDEX ${STAGING_ITEM_INDEX} ON ${STAGING_TABLE} (item_id)`)
    await client.query(`ANALYZE ${STAGING_TABLE}`)

    await client.query(DROP_NEIGHBORS_TABLE)
    await client.query(`ALTER TABLE ${STAGING_TABLE} RENAME TO ${NEIGHBORS_TABLE_NAME}`)
    await client.query(`ALTER INDEX ${BUILDER_SERVER_TABLE_SCHEMA}.${STAGING_ITEM_INDEX} RENAME TO ${NEIGHBORS_ITEM_INDEX}`)
    await client.query(`ALTER TABLE ${NEIGHBORS_TABLE} RENAME CONSTRAINT ${STAGING_PRIMARY_KEY} TO ${NEIGHBORS_PRIMARY_KEY}`)

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

async function insertInBatches(client: QueryableClient, rows: NeighborInsertRow[]): Promise<void> {
  for (let start = 0; start < rows.length; start += NEIGHBORS_INSERT_BATCH_SIZE) {
    const batch = rows.slice(start, start + NEIGHBORS_INSERT_BATCH_SIZE)
    const values: unknown[] = []
    const placeholders = batch
      .map((row, i) => {
        values.push(row.itemId, row.source, row.neighborId, row.sim, row.support, row.rank)
        const base = i * 6
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
      })
      .join(',')
    await client.query(`INSERT INTO ${STAGING_TABLE} (item_id, source, neighbor_id, sim, support, rank) VALUES ${placeholders}`, values)
  }
}
