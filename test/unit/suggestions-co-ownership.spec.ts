import { buildCoOwnershipNeighbors, computeNorms, type AcquisitionMatrix, type NeighborRow } from '../../src/logic/suggestions/co-ownership'

/**
 * Builds the compressed matrix the same way the job's loader does, so the damping is exercised too.
 * Every entry is a purchase: unpaid acquisitions are filtered out in SQL before they reach here.
 */
function matrixOf(wallets: number[][], itemCount: number): AcquisitionMatrix {
  const offsets: number[] = [0]
  const items: number[] = []
  const weights: number[] = []
  for (const wallet of wallets) {
    const damping = Math.pow(wallet.length, -0.25)
    for (const item of wallet) {
      items.push(item)
      weights.push(damping)
    }
    offsets.push(items.length)
  }
  return {
    offsets: Int32Array.from(offsets),
    items: Int32Array.from(items),
    weights: Float32Array.from(weights),
    walletCount: wallets.length,
    itemCount
  }
}

function paid(...items: number[]): number[] {
  return items
}

/** Similarity lookup that fails loudly when the pair is absent, rather than asserting on undefined. */
function simOf(rows: NeighborRow[], anchor: number, neighbor: number): number {
  const row = rows.find(entry => entry.item === anchor && entry.neighbor === neighbor)
  if (!row) throw new Error(`no neighbour row for ${anchor} -> ${neighbor}`)
  return row.sim
}

describe('when computing item norms', () => {
  let matrix: AcquisitionMatrix

  beforeEach(() => {
    matrix = matrixOf([paid(0, 1), paid(0, 1)], 2)
  })

  it('should give equally-held items equal norms', () => {
    const norms = computeNorms(matrix)
    expect(norms[0]).toBeCloseTo(norms[1], 6)
  })
})

describe('when building co-ownership neighbours', () => {
  describe('and two items are always held together by enough wallets', () => {
    let rows: NeighborRow[]

    beforeEach(() => {
      const wallets = Array.from({ length: 5 }, () => paid(0, 1))
      rows = buildCoOwnershipNeighbors(matrixOf(wallets, 2), Uint8Array.from([1, 1]), { minSupport: 3 })
    })

    it('should pair them in both directions', () => {
      expect(rows.map(row => [row.item, row.neighbor])).toEqual(
        expect.arrayContaining([
          [0, 1],
          [1, 0]
        ])
      )
    })

    it('should report the number of wallets that hold both', () => {
      expect(rows[0].support).toBe(5)
    })

    it('should shrink a perfectly correlated pair below a raw cosine of one', () => {
      expect(rows[0].sim).toBeCloseTo(5 / (5 + 10), 5)
    })
  })

  describe('and a pair has fewer co-owners than the minimum support', () => {
    let rows: NeighborRow[]

    beforeEach(() => {
      const wallets = [paid(0, 1), paid(0, 1)]
      rows = buildCoOwnershipNeighbors(matrixOf(wallets, 2), Uint8Array.from([1, 1]), { minSupport: 3 })
    })

    it('should drop it, because a two-wallet coincidence is the small-sample artifact this guards against', () => {
      expect(rows).toEqual([])
    })
  })

  describe('and a neighbour is not a candidate', () => {
    let rows: NeighborRow[]

    beforeEach(() => {
      const wallets = Array.from({ length: 5 }, () => paid(0, 1))
      rows = buildCoOwnershipNeighbors(matrixOf(wallets, 2), Uint8Array.from([1, 0]), { minSupport: 3 })
    })

    it('should never store a row pointing at it', () => {
      expect(rows.every(row => row.neighbor === 0)).toBe(true)
    })

    it('should still keep it as an anchor, because a profile can contain anything', () => {
      expect(rows.map(row => row.item)).toContain(1)
    })
  })

  describe('and the accumulator is blocked over neighbour columns', () => {
    let wide: NeighborRow[]
    let narrow: NeighborRow[]

    beforeEach(() => {
      const wallets = [
        ...Array.from({ length: 4 }, () => paid(0, 1, 2)),
        ...Array.from({ length: 4 }, () => paid(1, 2, 3)),
        ...Array.from({ length: 3 }, () => paid(0, 3))
      ]
      const matrix = matrixOf(wallets, 4)
      const candidates = Uint8Array.from([1, 1, 1, 1])
      wide = buildCoOwnershipNeighbors(matrix, candidates, { minSupport: 3, blockWidth: 64 })
      narrow = buildCoOwnershipNeighbors(matrix, candidates, { minSupport: 3, blockWidth: 1 })
    })

    it('should produce the same neighbours whatever the block width, since blocking is only a memory bound', () => {
      const key = (rows: NeighborRow[]) => rows.map(row => `${row.item}:${row.neighbor}:${row.sim.toFixed(6)}`).sort()
      expect(key(narrow)).toEqual(key(wide))
    })
  })

  describe('and a wallet holds many items', () => {
    let hoarderSim: number
    let focusedSim: number

    beforeEach(() => {
      const focused = Array.from({ length: 4 }, () => paid(0, 1))
      const hoarders = Array.from({ length: 4 }, () => paid(2, 3, 4, 5, 6, 7, 8, 9, 10, 11))
      const candidates = Uint8Array.from(Array(12).fill(1))
      focusedSim = simOf(buildCoOwnershipNeighbors(matrixOf(focused, 12), candidates, { minSupport: 3 }), 0, 1)
      hoarderSim = simOf(buildCoOwnershipNeighbors(matrixOf(hoarders, 12), candidates, { minSupport: 3 }), 2, 3)
    })

    it('should not let its breadth inflate similarity above a focused wallet at the same support', () => {
      expect(hoarderSim).toBeLessThanOrEqual(focusedSim + 1e-6)
    })
  })

  describe('and more candidates qualify than the neighbour cap allows', () => {
    let rows: NeighborRow[]

    beforeEach(() => {
      const wallets = Array.from({ length: 5 }, () => paid(0, 1, 2, 3, 4))
      rows = buildCoOwnershipNeighbors(matrixOf(wallets, 5), Uint8Array.from([1, 1, 1, 1, 1]), {
        minSupport: 3,
        neighborsPerItem: 2
      })
    })

    it('should keep only the cap for each anchor', () => {
      expect(rows.filter(row => row.item === 0)).toHaveLength(2)
    })

    it("should return each anchor's neighbours strongest first", () => {
      const sims = rows.filter(row => row.item === 0).map(row => row.sim)
      expect(sims[0]).toBeGreaterThanOrEqual(sims[1])
    })
  })
})
