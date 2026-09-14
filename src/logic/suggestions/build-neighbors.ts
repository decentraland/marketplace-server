import Cursor from 'pg-cursor'
import { Rarity } from '@dcl/schemas'
import { buildCoOwnershipNeighbors, type AcquisitionMatrix, type NeighborRow } from './co-ownership'
import { FREE_ACQUISITION_WEIGHT, NEIGHBORS_PER_ITEM } from './constants'
import { assignPriceBands, buildTagVectors, contentNeighborsByAnchor, type ContentItem } from './content'
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
 * `weights` folds both the airdrop discount and the hoarder damping in at load time:
 * `w(u,i) * |items(u)|^(-1/4)`, so that `Σ x_a·x_b` over a wallet is `Σ w_a·w_b / sqrt(|items(u)|)`.
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
  const paidFlags: boolean[] = []
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
        paidFlags.push(row[2] === true)
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
    for (let i = offsets[wallet]; i < offsets[wallet + 1]; i++) {
      weights[i] = (paidFlags[i] ? 1 : FREE_ACQUISITION_WEIGHT) * damping
    }
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
export function toInsertRows(rows: NeighborRow[], source: string, items: ItemRecord[]): NeighborInsertRow[] {
  const out: NeighborInsertRow[] = []
  let currentItem = -1
  let rank = 0
  for (const row of rows) {
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

export type BuildOptions = {
  blockWidth?: number
  /** Abort the acquisition scan past this, leaving the previous neighbours serving. */
  acquisitionDeadlineMs?: number
}

export type BuildTimings = {
  catalogueMs: number
  acquisitionsMs: number
  coOwnershipMs: number
  contentMs: number
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
  let cfRows: NeighborInsertRow[] | null = toInsertRows(
    buildCoOwnershipNeighbors(matrix, isCandidate, { blockWidth: options.blockWidth }),
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
  for (const anchorRows of contentNeighborsByAnchor(contentItems)) {
    const converted = toInsertRows(anchorRows, 'content', catalogue.items)
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

  onTimings?.(timings)

  return {
    cfRows: cfCount,
    contentRows: contentCount,
    itemsCovered: covered.size,
    durationMs: Date.now() - jobStarted
  }
}
