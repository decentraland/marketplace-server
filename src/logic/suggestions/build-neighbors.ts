import { Rarity } from '@dcl/schemas'
import { buildCoOwnershipNeighbors, type AcquisitionMatrix, type NeighborRow } from './co-ownership'
import { FREE_ACQUISITION_WEIGHT, NEIGHBORS_PER_ITEM } from './constants'
import { assignPriceBands, buildContentNeighbors, buildTagVectors, type ContentItem } from './content'
import { SELECT_ACQUISITIONS, SELECT_ITEMS, SELECT_TAGS, type QueryableClient } from './neighbors-table'

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
 * Acquisitions as a compressed row matrix. The query returns them ordered by wallet, so the wallet
 * boundaries fall out of a single scan and the ids never need a second pass.
 *
 * `weights` folds both the airdrop discount and the hoarder damping in at load time:
 * `w(u,i) * |items(u)|^(-1/4)`, so that `Σ x_a·x_b` over a wallet is `Σ w_a·w_b / sqrt(|items(u)|)`.
 */
export async function loadAcquisitions(client: QueryableClient, catalogue: LoadedCatalogue): Promise<AcquisitionMatrix> {
  const { rows } = await client.query(SELECT_ACQUISITIONS)

  const offsets: number[] = [0]
  const items: number[] = []
  const paidFlags: boolean[] = []
  let currentWallet: string | undefined

  for (const row of rows) {
    const index = catalogue.indexById.get(String(row.item_id))
    if (index === undefined) continue
    const wallet = String(row.wallet)
    if (wallet !== currentWallet) {
      if (currentWallet !== undefined) offsets.push(items.length)
      currentWallet = wallet
    }
    items.push(index)
    paidFlags.push(row.paid === true)
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
    offsets: Int32Array.from(offsets),
    items: Int32Array.from(items),
    weights,
    walletCount,
    itemCount: catalogue.items.length
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

export type NeighborInsertRow = {
  itemId: string
  source: string
  neighborId: string
  sim: number
  support: number
  rank: number
}

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

export type BuildResult = {
  rows: NeighborInsertRow[]
  cfRows: number
  contentRows: number
  itemsCovered: number
}

/** Loads the catalogue and acquisitions, runs both generators, and returns rows ready to insert. */
export async function buildNeighborRows(client: QueryableClient, blockWidth?: number): Promise<BuildResult> {
  const catalogue = await loadCatalogue(client)
  const matrix = await loadAcquisitions(client, catalogue)

  const isCandidate = new Uint8Array(catalogue.items.length)
  for (const item of catalogue.items) isCandidate[item.index] = item.isCandidate ? 1 : 0

  const cf = toInsertRows(buildCoOwnershipNeighbors(matrix, isCandidate, { blockWidth }), 'cf', catalogue.items)

  const contentItems = await loadContentItems(client, catalogue)
  const content = toInsertRows(buildContentNeighbors(contentItems), 'content', catalogue.items)

  const covered = new Set<string>()
  for (const row of cf) covered.add(row.itemId)
  for (const row of content) covered.add(row.itemId)

  return {
    rows: [...cf, ...content],
    cfRows: cf.length,
    contentRows: content.length,
    itemsCovered: covered.size
  }
}
