import { CO_OWNERSHIP_SHRINKAGE, MIN_CO_OWNERS, NEIGHBORS_PER_ITEM } from './constants'

/**
 * Acquisitions in compressed row form, one row per wallet. Wallet `w` owns the entries in
 * `[offsets[w], offsets[w + 1])`. `weights` already carries the hoarder damping, so the maths below
 * never needs the wallet's size again.
 */
export type AcquisitionMatrix = {
  offsets: Int32Array
  items: Int32Array
  weights: Float32Array
  walletCount: number
  itemCount: number
}

export type NeighborRow = {
  item: number
  neighbor: number
  sim: number
  support: number
}

export type CoOwnershipOptions = {
  minSupport?: number
  neighborsPerItem?: number
  shrinkage?: number
  /**
   * Neighbour columns accumulated per pass. The accumulator is `itemCount * blockWidth` cells, so
   * this is the knob that trades memory for passes: the full matrix would be ~800 MB at current
   * catalogue size, which cannot live inside the API process.
   */
  blockWidth?: number
}

/**
 * Neighbour columns per accumulation pass.
 *
 * Measured against production: 512 peaks at 537 MB and 128 at 411 MB, for 1.0 s versus 1.3 s of
 * accumulation inside a ~115 s job. The narrower block is effectively free, and this job shares a
 * 2 GB task with the API, so it takes the memory.
 */
export const DEFAULT_BLOCK_WIDTH = 128

/**
 * The per-item weight vector's L2 norm, over the same damped weights the dot products use. Together
 * they make `dot / (norm_a * norm_b)` a plain cosine.
 */
export function computeNorms(matrix: AcquisitionMatrix): Float64Array {
  const norms = new Float64Array(matrix.itemCount)
  for (let i = 0; i < matrix.items.length; i++) {
    const weight = matrix.weights[i]
    norms[matrix.items[i]] += weight * weight
  }
  for (let i = 0; i < norms.length; i++) norms[i] = Math.sqrt(norms[i])
  return norms
}

/**
 * Item-item co-ownership neighbours: for every anchor item, the top-K candidate items most often held
 * by the same wallets, as a cosine shrunk by the co-owner count.
 *
 * Anchors are EVERY item, not just candidates — a wallet's profile can contain anything, including
 * items that were never sellable — while neighbours are restricted to `isCandidate`, because a row
 * whose neighbour can never be recommended is dead weight in the table.
 *
 * The accumulator is blocked over neighbour columns rather than allocated whole: one pass per block,
 * each anchor's block-local best merged into a running top-K. That keeps peak memory at
 * `itemCount * blockWidth * 8` bytes regardless of catalogue size.
 */
export function buildCoOwnershipNeighbors(
  matrix: AcquisitionMatrix,
  isCandidate: Uint8Array,
  options: CoOwnershipOptions = {}
): NeighborRow[] {
  const minSupport = options.minSupport ?? MIN_CO_OWNERS
  const k = options.neighborsPerItem ?? NEIGHBORS_PER_ITEM
  const shrinkage = options.shrinkage ?? CO_OWNERSHIP_SHRINKAGE
  const blockWidth = Math.max(1, options.blockWidth ?? DEFAULT_BLOCK_WIDTH)

  const { itemCount } = matrix
  const norms = computeNorms(matrix)

  const columns: number[] = []
  const columnOf = new Int32Array(itemCount).fill(-1)
  for (let item = 0; item < itemCount; item++) {
    if (isCandidate[item] === 1 && norms[item] > 0) {
      columnOf[item] = columns.length
      columns.push(item)
    }
  }
  if (columns.length === 0) return []

  const heaps = new TopKHeaps(itemCount, k)
  const width = Math.min(blockWidth, columns.length)
  const dot = new Float64Array(itemCount * width)
  const support = new Uint32Array(itemCount * width)
  const inBlock = new Int32Array(MAX_WALLET_ITEMS_BUFFER)
  const inBlockWeight = new Float64Array(MAX_WALLET_ITEMS_BUFFER)

  for (let blockStart = 0; blockStart < columns.length; blockStart += width) {
    const blockEnd = Math.min(blockStart + width, columns.length)
    const blockSize = blockEnd - blockStart
    dot.fill(0)
    support.fill(0)

    for (let wallet = 0; wallet < matrix.walletCount; wallet++) {
      const from = matrix.offsets[wallet]
      const to = matrix.offsets[wallet + 1]

      let hits = 0
      for (let i = from; i < to; i++) {
        // Out-of-bounds writes to a typed array are silent no-ops, so without this a wallet larger
        // than the buffer would quietly produce wrong dot products rather than fail. The SQL band
        // keeps wallets under MAX_WALLET_ITEMS, but the two are deliberately independent and the
        // margin is now thin (500 against 512), so the guard is what makes that independence safe.
        if (hits >= inBlock.length) break
        const column = columnOf[matrix.items[i]]
        if (column >= blockStart && column < blockEnd) {
          inBlock[hits] = column - blockStart
          inBlockWeight[hits] = matrix.weights[i]
          hits += 1
        }
      }
      if (hits === 0) continue

      for (let i = from; i < to; i++) {
        const anchor = matrix.items[i]
        const anchorWeight = matrix.weights[i]
        const anchorColumn = columnOf[anchor] - blockStart
        const base = anchor * width
        for (let j = 0; j < hits; j++) {
          const column = inBlock[j]
          if (column === anchorColumn) continue
          dot[base + column] += anchorWeight * inBlockWeight[j]
          support[base + column] += 1
        }
      }
    }

    for (let anchor = 0; anchor < itemCount; anchor++) {
      const anchorNorm = norms[anchor]
      if (anchorNorm === 0) continue
      const base = anchor * width
      for (let column = 0; column < blockSize; column++) {
        const co = support[base + column]
        if (co < minSupport) continue
        const neighbor = columns[blockStart + column]
        const denominator = anchorNorm * norms[neighbor]
        if (denominator === 0) continue
        const sim = (dot[base + column] / denominator) * (co / (co + shrinkage))
        if (sim > 0) heaps.offer(anchor, neighbor, sim, co)
      }
    }
  }

  return heaps.drain()
}

/** Per-wallet scratch space. Sized independently of MAX_WALLET_ITEMS so this file does not have to
 * track the SQL band; the bounds check in the accumulation loop is what keeps that safe. */
const MAX_WALLET_ITEMS_BUFFER = 512

/** One bounded min-heap per anchor, flat so there is no per-item object allocation. */
class TopKHeaps {
  private readonly sims: Float64Array
  private readonly neighbors: Int32Array
  private readonly supports: Uint32Array
  private readonly sizes: Int32Array

  constructor(private readonly itemCount: number, private readonly k: number) {
    this.sims = new Float64Array(itemCount * k)
    this.neighbors = new Int32Array(itemCount * k)
    this.supports = new Uint32Array(itemCount * k)
    this.sizes = new Int32Array(itemCount)
  }

  offer(anchor: number, neighbor: number, sim: number, support: number): void {
    const base = anchor * this.k
    const size = this.sizes[anchor]
    if (size < this.k) {
      this.sims[base + size] = sim
      this.neighbors[base + size] = neighbor
      this.supports[base + size] = support
      this.sizes[anchor] = size + 1
      if (size + 1 === this.k) this.heapify(base)
      return
    }
    if (sim <= this.sims[base]) return
    this.sims[base] = sim
    this.neighbors[base] = neighbor
    this.supports[base] = support
    this.siftDown(base, 0, this.k)
  }

  drain(): NeighborRow[] {
    const rows: NeighborRow[] = []
    for (let anchor = 0; anchor < this.itemCount; anchor++) {
      const size = this.sizes[anchor]
      if (size === 0) continue
      const base = anchor * this.k
      const slice: NeighborRow[] = []
      for (let i = 0; i < size; i++) {
        slice.push({
          item: anchor,
          neighbor: this.neighbors[base + i],
          sim: this.sims[base + i],
          support: this.supports[base + i]
        })
      }
      slice.sort((a, b) => b.sim - a.sim)
      rows.push(...slice)
    }
    return rows
  }

  private heapify(base: number): void {
    for (let i = (this.k >> 1) - 1; i >= 0; i--) this.siftDown(base, i, this.k)
  }

  private siftDown(base: number, start: number, size: number): void {
    let root = start
    for (;;) {
      const left = 2 * root + 1
      if (left >= size) break
      let smallest = left
      const right = left + 1
      if (right < size && this.sims[base + right] < this.sims[base + left]) smallest = right
      if (this.sims[base + smallest] >= this.sims[base + root]) break
      this.swap(base + root, base + smallest)
      root = smallest
    }
  }

  private swap(a: number, b: number): void {
    const sim = this.sims[a]
    this.sims[a] = this.sims[b]
    this.sims[b] = sim
    const neighbor = this.neighbors[a]
    this.neighbors[a] = this.neighbors[b]
    this.neighbors[b] = neighbor
    const support = this.supports[a]
    this.supports[a] = this.supports[b]
    this.supports[b] = support
  }
}
