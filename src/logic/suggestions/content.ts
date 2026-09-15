import type { NeighborRow } from './co-ownership'
import { CONTENT_WEIGHTS as W, MAX_TAG_DOCUMENT_FREQUENCY, NEIGHBORS_PER_ITEM } from './constants'

export type ContentItem = {
  index: number
  creator: string
  collection: string
  /** Wearable or emote sub-category, prefixed with the kind so a wearable "hat" and an emote
   * category can never collide. Empty when the item declares neither. */
  subCategory: string
  rarityTier: number
  priceBand: number
  isCandidate: boolean
  tags: Uint32Array
  /** IDF weights, already L2-normalised, aligned with `tags`. */
  tagWeights: Float32Array
}

export type ContentOptions = {
  neighborsPerItem?: number
  maxTagDocumentFrequency?: number
}

type InvertedIndex = {
  byCreator: Map<string, number[]>
  byCollection: Map<string, number[]>
  bySubCategory: Map<string, number[]>
  /** tag -> (candidate index, that candidate's IDF weight for the tag). Carrying the weight in the
   * posting is what keeps the cosine a single pass instead of a lookup per pair. */
  postings: Map<number, Array<[number, number]>>
}

function push(map: Map<string, number[]>, key: string, value: number): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function buildIndex(items: ContentItem[], maxTagDocumentFrequency: number): InvertedIndex {
  const byCreator = new Map<string, number[]>()
  const byCollection = new Map<string, number[]>()
  const bySubCategory = new Map<string, number[]>()
  const postings = new Map<number, Array<[number, number]>>()

  for (const item of items) {
    if (!item.isCandidate) continue
    if (item.creator) push(byCreator, item.creator, item.index)
    if (item.collection) push(byCollection, item.collection, item.index)
    if (item.subCategory) push(bySubCategory, item.subCategory, item.index)
    for (let i = 0; i < item.tags.length; i++) {
      const posting: [number, number] = [item.index, item.tagWeights[i]]
      const list = postings.get(item.tags[i])
      if (list) list.push(posting)
      else postings.set(item.tags[i], [posting])
    }
  }

  // A tag carried by thousands of items says nothing about any of them, and its posting list is what
  // makes this pass expensive. Dropping it is the IDF decision made structural.
  for (const [tag, list] of postings) {
    if (list.length > maxTagDocumentFrequency) postings.delete(tag)
  }

  return { byCreator, byCollection, bySubCategory, postings }
}

/**
 * Content neighbours: attribute overlap between an anchor and every candidate it plausibly resembles.
 *
 * The pool is the union of the creator, collection, sub-category and shared-tag buckets. Anything
 * outside it can only match on rarity and price band, which caps its score at 0.15 — below what any
 * single bucket membership already scores — so it cannot displace a pooled candidate from a top-50
 * list. Scanning the whole catalogue per anchor to prove that would cost ~130M comparisons.
 */
export function buildContentNeighbors(items: ContentItem[], options: ContentOptions = {}): NeighborRow[] {
  const rows: NeighborRow[] = []
  for (const anchorRows of contentNeighborsByAnchor(items, options)) rows.push(...anchorRows)
  return rows
}

/**
 * The same computation, yielded one anchor at a time.
 *
 * The content pass produces ~590k rows across the catalogue — more than co-ownership, because every
 * anchor gets a full list whereas co-ownership only reaches items with enough co-owners. Materialising
 * them all was the largest remaining item in the job's memory profile, so the job consumes this and
 * writes as it goes.
 */
export function* contentNeighborsByAnchor(items: ContentItem[], options: ContentOptions = {}): Generator<NeighborRow[]> {
  const k = options.neighborsPerItem ?? NEIGHBORS_PER_ITEM
  const index = buildIndex(items, options.maxTagDocumentFrequency ?? MAX_TAG_DOCUMENT_FREQUENCY)

  const tagDot = new Float64Array(items.length)
  const touched: number[] = []
  const pool = new Set<number>()

  for (const anchor of items) {
    for (let i = 0; i < anchor.tags.length; i++) {
      const list = index.postings.get(anchor.tags[i])
      if (!list) continue
      const anchorWeight = anchor.tagWeights[i]
      for (const [candidate, candidateWeight] of list) {
        if (tagDot[candidate] === 0) touched.push(candidate)
        tagDot[candidate] += anchorWeight * candidateWeight
      }
    }

    pool.clear()
    for (const candidate of touched) pool.add(candidate)
    for (const list of [
      anchor.creator ? index.byCreator.get(anchor.creator) : undefined,
      anchor.collection ? index.byCollection.get(anchor.collection) : undefined,
      anchor.subCategory ? index.bySubCategory.get(anchor.subCategory) : undefined
    ]) {
      if (list) for (const candidate of list) pool.add(candidate)
    }
    pool.delete(anchor.index)

    const scored: NeighborRow[] = []
    for (const candidateIndex of pool) {
      const candidate = items[candidateIndex]
      let sim = 0
      if (anchor.creator && anchor.creator === candidate.creator) sim += W.creator
      if (anchor.collection && anchor.collection === candidate.collection) sim += W.collection
      if (anchor.subCategory && anchor.subCategory === candidate.subCategory) sim += W.subCategory
      if (anchor.rarityTier >= 0 && candidate.rarityTier >= 0 && Math.abs(anchor.rarityTier - candidate.rarityTier) <= 1) {
        sim += W.rarity
      }
      const dot = tagDot[candidateIndex]
      if (dot > 0) sim += W.tags * Math.min(1, dot)
      if (anchor.priceBand >= 0 && anchor.priceBand === candidate.priceBand) sim += W.priceBand
      if (sim > 0) scored.push({ item: anchor.index, neighbor: candidateIndex, sim, support: 0 })
    }

    for (const candidate of touched) tagDot[candidate] = 0
    touched.length = 0

    scored.sort((a, b) => b.sim - a.sim || a.neighbor - b.neighbor)
    if (scored.length > k) scored.length = k
    if (scored.length > 0) yield scored
  }
}

/** Price quartile within the item's own sub-category, so "expensive" means expensive for a hat. */
export function assignPriceBands(prices: Array<{ index: number; subCategory: string; price: number }>): Map<number, number> {
  const bands = new Map<number, number>()
  const buckets = new Map<string, Array<{ index: number; price: number }>>()
  for (const entry of prices) {
    if (!(entry.price > 0)) continue
    const bucket = buckets.get(entry.subCategory)
    if (bucket) bucket.push(entry)
    else buckets.set(entry.subCategory, [entry])
  }
  for (const bucket of buckets.values()) {
    const sorted = [...bucket].sort((a, b) => a.price - b.price)
    const cuts = [0.25, 0.5, 0.75].map(q => sorted[Math.floor(q * (sorted.length - 1))].price)
    for (const entry of bucket) {
      bands.set(entry.index, entry.price <= cuts[0] ? 0 : entry.price <= cuts[1] ? 1 : entry.price <= cuts[2] ? 2 : 3)
    }
  }
  return bands
}

/** IDF over the corpus, L2-normalised per item so the dot product above is a cosine. */
export function buildTagVectors(
  tagsByItem: Map<number, number[]>,
  documentFrequency: number[],
  corpusSize: number
): Map<number, { tags: Uint32Array; weights: Float32Array }> {
  const vectors = new Map<number, { tags: Uint32Array; weights: Float32Array }>()
  for (const [item, tags] of tagsByItem) {
    const weights = tags.map(tag => Math.log(1 + corpusSize / (1 + documentFrequency[tag])))
    let sumOfSquares = 0
    for (const weight of weights) sumOfSquares += weight * weight
    const norm = Math.sqrt(sumOfSquares) || 1
    vectors.set(item, {
      tags: Uint32Array.from(tags),
      weights: Float32Array.from(weights.map(weight => weight / norm))
    })
  }
  return vectors
}
