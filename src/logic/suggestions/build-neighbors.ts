import Cursor from 'pg-cursor'
import { Rarity } from '@dcl/schemas'
import { WornNeighborsUnavailableError, type IWornNeighborsComponent } from '../../ports/worn-neighbors'
import { buildCoOwnershipNeighbors, type AcquisitionMatrix, type NeighborRow } from './co-ownership'
import { NEIGHBORS_PER_ITEM } from './constants'
import { assignPriceBands, buildTagVectors, contentNeighborsByAnchor, type ContentItem } from './content'
import { YIELD_EVERY_STEPS, yieldToEventLoop } from './cooperative'
import {
  SELECT_ACQUISITIONS,
  SELECT_ITEMS,
  SELECT_TAGS,
  type NeighborInsertRow,
  type NeighborsMeta,
  type QueryableClient
} from './neighbors-table'

const RARITY_TIERS = Rarity.getRarities().map(rarity => rarity.toLowerCase())

export type ItemRecord = {
  index: number
  id: string
  creator: string
  collection: string
  subCategory: string
  rarityTier: number
  price: number
  isCandidate: boolean
}

export type LoadedCatalogue = {
  items: ItemRecord[]
  indexById: Map<string, number>
}

export async function loadCatalogue(client: QueryableClient): Promise<LoadedCatalogue> {
  const { rows } = await client.query(SELECT_ITEMS)
  const items: ItemRecord[] = []
  const indexById = new Map<string, number>()
  for (const row of rows) {
    const id = String(row.item_id)
    const index = items.length
    indexById.set(id, index)
    items.push({
      index,
      id,
      creator: String(row.creator ?? ''),
      collection: String(row.collection_id ?? ''),
      subCategory: String(row.sub_category ?? ''),
      rarityTier: RARITY_TIERS.indexOf(String(row.rarity ?? '').toLowerCase()),
      price: Number(row.price ?? 0),
      isCandidate: row.is_candidate === true
    })
  }
  return { items, indexById }
}

/**
 * A client that can also open a cursor, which is how the acquisition scan avoids materialising 2M rows.
 * `openCursor` is separate from `query` because node-postgres overloads one method for both, and an
 * intersection of those two signatures is not something a plain object can satisfy.
 */
export type CursorClient = QueryableClient & {
  openCursor: (cursor: Cursor) => Cursor
}

/**
 * Wraps a node-postgres client, whose `query` doubles as the cursor entry point.
 *
 * Both calls stay bound to the original client: node-postgres reaches for its own connection through
 * `this`, so handing the method around detached leaves the cursor submitting against nothing.
 */
export function asCursorClient(client: QueryableClient): CursorClient {
  return {
    query: (sql: string, values?: unknown[]) => client.query(sql, values),
    openCursor: (cursor: Cursor) => (client as unknown as { query: (c: Cursor) => Cursor }).query(cursor)
  }
}

/** Rows read per cursor fetch. Large enough to keep the round trips down, small enough that a batch
 * of row objects is transient garbage rather than a memory spike. */
const ACQUISITION_BATCH_SIZE = 20_000

export type AcquisitionLoadResult = {
  matrix: AcquisitionMatrix
  walletsSeen: number
  rowsRead: number
}

/**
 * Acquisitions as a compressed row matrix, streamed.
 *
 * The query returns rows ordered by wallet and they are folded into typed arrays as they arrive, so the
 * 2M (wallet, item) pairs never exist as JS objects at the same time — that materialisation, not the
 * arithmetic, was what cost 385 MB. What is retained is ~18 MB of Int32/Float32 arrays.
 *
 * They are retained rather than consumed wallet-by-wallet because the neighbour accumulator is blocked
 * over columns and therefore makes several passes; re-running an 80-second scan once per block would
 * trade 500 MB for fifteen minutes.
 *
 * Every row is a purchase — unpaid acquisitions are filtered in SQL — so the only per-row weight left
 * is the hoarder damping, `|items(u)|^(-1/4)`, which makes `Σ x_a·x_b` over a wallet equal
 * `Σ 1 / sqrt(|items(u)|)`.
 */
export async function loadAcquisitions(
  client: CursorClient,
  catalogue: LoadedCatalogue,
  options: { onSlowScan?: () => void; deadlineMs?: number } = {}
): Promise<AcquisitionLoadResult> {
  const started = Date.now()
  const cursor = client.openCursor(new Cursor(SELECT_ACQUISITIONS, [], { rowMode: 'array' }))

  const offsets: number[] = [0]
  const items: number[] = []
  let currentWallet: string | undefined
  let rowsRead = 0

  try {
    for (;;) {
      const rows: unknown[][] = await new Promise((resolve, reject) => {
        cursor.read(ACQUISITION_BATCH_SIZE, (error, batch) => (error ? reject(error) : resolve(batch)))
      })
      if (rows.length === 0) break
      rowsRead += rows.length

      for (const row of rows) {
        const index = catalogue.indexById.get(String(row[1]))
        if (index === undefined) continue
        const wallet = String(row[0])
        if (wallet !== currentWallet) {
          if (currentWallet !== undefined) offsets.push(items.length)
          currentWallet = wallet
        }
        items.push(index)
      }

      if (options.deadlineMs !== undefined && Date.now() - started > options.deadlineMs) {
        options.onSlowScan?.()
        throw new Error(`acquisition scan exceeded ${options.deadlineMs} ms`)
      }
    }
  } finally {
    await new Promise<void>(resolve => cursor.close(() => resolve()))
  }

  if (currentWallet !== undefined) offsets.push(items.length)

  const walletCount = offsets.length - 1
  const weights = new Float32Array(items.length)
  for (let wallet = 0; wallet < walletCount; wallet++) {
    const size = offsets[wallet + 1] - offsets[wallet]
    if (size === 0) continue
    const damping = Math.pow(size, -0.25)
    for (let i = offsets[wallet]; i < offsets[wallet + 1]; i++) weights[i] = damping
  }

  return {
    matrix: {
      offsets: Int32Array.from(offsets),
      items: Int32Array.from(items),
      weights,
      walletCount,
      itemCount: catalogue.items.length
    },
    walletsSeen: walletCount,
    rowsRead
  }
}

export async function loadContentItems(client: QueryableClient, catalogue: LoadedCatalogue): Promise<ContentItem[]> {
  const { rows } = await client.query(SELECT_TAGS)

  const tagIds = new Map<string, number>()
  const documentFrequency: number[] = []
  const tagsByItem = new Map<number, number[]>()

  for (const row of rows) {
    const index = catalogue.indexById.get(String(row.item_id))
    if (index === undefined) continue
    const name = String(row.tag)
    let tagId = tagIds.get(name)
    if (tagId === undefined) {
      tagId = documentFrequency.length
      tagIds.set(name, tagId)
      documentFrequency.push(0)
    }
    const list = tagsByItem.get(index)
    if (!list) {
      tagsByItem.set(index, [tagId])
      documentFrequency[tagId] += 1
    } else if (!list.includes(tagId)) {
      list.push(tagId)
      documentFrequency[tagId] += 1
    }
  }

  const vectors = buildTagVectors(tagsByItem, documentFrequency, catalogue.items.length)
  const bands = assignPriceBands(catalogue.items.map(item => ({ index: item.index, subCategory: item.subCategory, price: item.price })))

  return catalogue.items.map(item => {
    const vector = vectors.get(item.index)
    return {
      index: item.index,
      creator: item.creator,
      collection: item.collection,
      subCategory: item.subCategory,
      rarityTier: item.rarityTier,
      priceBand: bands.get(item.index) ?? -1,
      isCandidate: item.isCandidate,
      tags: vector?.tags ?? EMPTY_TAGS,
      tagWeights: vector?.weights ?? EMPTY_WEIGHTS
    }
  })
}

const EMPTY_TAGS = new Uint32Array(0)
const EMPTY_WEIGHTS = new Float32Array(0)

/** Neighbour rows -> insertable rows, numbering each anchor's list so the endpoint can cut by rank. */
/**
 * Async only so it can yield: the conversion is a single pass whose rank counter depends on the rows
 * before it, so it cannot be split into independent chunks -- but it CAN be paused between them.
 */
export async function toInsertRows(rows: NeighborRow[], source: string, items: ItemRecord[]): Promise<NeighborInsertRow[]> {
  const out: NeighborInsertRow[] = []
  let currentItem = -1
  let rank = 0
  let step = 0
  for (const row of rows) {
    if (step > 0 && step % YIELD_EVERY_STEPS === 0) await yieldToEventLoop()
    step += 1
    if (row.item !== currentItem) {
      currentItem = row.item
      rank = 0
    }
    if (rank >= NEIGHBORS_PER_ITEM) continue
    out.push({
      itemId: items[row.item].id,
      source,
      neighborId: items[row.neighbor].id,
      sim: row.sim,
      support: row.support,
      rank
    })
    rank += 1
  }
  return out
}

/** Content rows held before a write. Each anchor contributes at most NEIGHBORS_PER_ITEM, so this is
 * a few hundred anchors' worth -- enough to keep the inserts batched, small enough that the ~590k-row
 * content set never exists all at once. */
const CONTENT_FLUSH_SIZE = 20_000

/**
 * Anchors between two yields in the content stage.
 *
 * Measured against production data (11,790 items, 8,024 wallets): this stage, not the co-ownership
 * accumulator, is the job's longest stall by an order of magnitude, and the cadence is what bounds it.
 * Over repeated runs the worst slice was 268-339 ms every 500 anchors, 67 ms every 100, and 45-83 ms
 * every 25, for single-digit-percent more wall time on a stage that runs once every six hours. The
 * stall is what the API's latency pays for; the wall time is not. (The figures come from a developer
 * machine running other work, so read them as an order of magnitude and a ranking, not as a budget.)
 */
const CONTENT_YIELD_EVERY_ANCHORS = 25

export type BuildOptions = {
  blockWidth?: number
  /** Abort the acquisition scan past this, leaving the previous neighbours serving. */
  acquisitionDeadlineMs?: number
  /** Where the co-wear source is read from. Absent, the source is not built. */
  worn?: {
    neighbors: IWornNeighborsComponent
    discard: () => Promise<void>
  }
}

export type BuildTimings = {
  catalogueMs: number
  acquisitionsMs: number
  coOwnershipMs: number
  contentMs: number
  wornMs: number
  /** Set when the co-wear source failed; the other two sources are still swapped in. */
  wornError?: unknown
  walletsSeen: number
  rowsRead: number
}

/**
 * Computes both neighbour sets and hands each to `insert` as soon as it exists.
 *
 * The two sets are produced and released one at a time on purpose. Holding the co-ownership rows, the
 * content rows and the concatenation of both was the largest single item in this job's memory profile
 * once the acquisition scan had been moved onto a cursor -- ~940k objects, twice over. Emitting each set
 * and dropping the reference keeps only one of them live at a time.
 */
export async function produceNeighborRows(
  client: CursorClient,
  insert: (rows: NeighborInsertRow[]) => Promise<void>,
  options: BuildOptions = {},
  onTimings?: (timings: BuildTimings) => void
): Promise<NeighborsMeta> {
  const jobStarted = Date.now()
  const timings: BuildTimings = {
    catalogueMs: 0,
    acquisitionsMs: 0,
    coOwnershipMs: 0,
    contentMs: 0,
    wornMs: 0,
    walletsSeen: 0,
    rowsRead: 0
  }

  let started = Date.now()
  const catalogue = await loadCatalogue(client)
  timings.catalogueMs = Date.now() - started

  started = Date.now()
  const { matrix, walletsSeen, rowsRead } = await loadAcquisitions(client, catalogue, {
    deadlineMs: options.acquisitionDeadlineMs
  })
  timings.acquisitionsMs = Date.now() - started
  timings.walletsSeen = walletsSeen
  timings.rowsRead = rowsRead

  const isCandidate = new Uint8Array(catalogue.items.length)
  for (const item of catalogue.items) isCandidate[item.index] = item.isCandidate ? 1 : 0

  const covered = new Set<string>()

  started = Date.now()
  let cfRows: NeighborInsertRow[] | null = await toInsertRows(
    await buildCoOwnershipNeighbors(matrix, isCandidate, { blockWidth: options.blockWidth }),
    'cf',
    catalogue.items
  )
  timings.coOwnershipMs = Date.now() - started
  const cfCount = cfRows.length
  for (const row of cfRows) covered.add(row.itemId)
  await insert(cfRows)
  cfRows = null

  started = Date.now()
  const contentItems = await loadContentItems(client, catalogue)
  let contentCount = 0
  let buffer: NeighborInsertRow[] = []
  let anchorsSinceYield = 0
  for (const anchorRows of contentNeighborsByAnchor(contentItems)) {
    // The generator is synchronous, so its `yield` never reaches the event loop -- without this the
    // whole content stage is one stall broken only by the occasional flush.
    anchorsSinceYield += 1
    if (anchorsSinceYield >= CONTENT_YIELD_EVERY_ANCHORS) {
      anchorsSinceYield = 0
      await yieldToEventLoop()
    }
    const converted = await toInsertRows(anchorRows, 'content', catalogue.items)
    contentCount += converted.length
    for (const row of converted) covered.add(row.itemId)
    buffer.push(...converted)
    if (buffer.length >= CONTENT_FLUSH_SIZE) {
      await insert(buffer)
      buffer = []
    }
  }
  if (buffer.length > 0) await insert(buffer)
  timings.contentMs = Date.now() - started

  // A registry that is down or slow costs the rail its co-wear rows for one cycle, never the rebuild.
  let wornCount = 0
  if (options.worn) {
    started = Date.now()
    const wornCovered = new Set<string>()
    try {
      const wornCatalogue = {
        anchorIds: catalogue.items.map(item => item.id),
        candidateIds: catalogue.items.filter(item => item.isCandidate).map(item => item.id)
      }
      for await (const rows of options.worn.neighbors.getNeighbors(wornCatalogue)) {
        for (const row of rows) wornCovered.add(row.itemId)
        await insert(rows)
        wornCount += rows.length
      }
      for (const itemId of wornCovered) covered.add(itemId)
    } catch (error) {
      // Only the registry's failures are the source's own; a failed write means the whole swap is lost.
      if (!(error instanceof WornNeighborsUnavailableError)) throw error
      timings.wornError = error
      wornCount = 0
      await options.worn.discard()
    }
    timings.wornMs = Date.now() - started
  }

  onTimings?.(timings)

  return {
    cfRows: cfCount,
    contentRows: contentCount,
    wornRows: wornCount,
    itemsCovered: covered.size,
    durationMs: Date.now() - jobStarted
  }
}
