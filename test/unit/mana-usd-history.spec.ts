import { readPhases, roundAtOrBefore, roundId, toDecimal } from '../../src/ports/mana-usd-history/history'
import { OracleReader, OracleRound } from '../../src/ports/mana-usd-history/types'

// Two phases: the first ended after 40 rounds, the second has run 25. One round every 100 seconds.
function fakeOracle(): { reader: OracleReader; reads: () => number } {
  const phases = new Map<number, { start: number; length: number }>([
    [1, { start: 1000, length: 40 }],
    [2, { start: 10_000, length: 25 }]
  ])
  let reads = 0
  const at = (phase: number, index: bigint): OracleRound | null => {
    const p = phases.get(phase)
    if (!p || index < 1n || index > BigInt(p.length)) return null
    return { id: roundId(phase, index), answer: BigInt(phase * 1000) + index, updatedAt: p.start + Number(index) * 100 }
  }
  return {
    reads: () => reads,
    reader: {
      decimals: () => Promise.resolve(8),
      phaseId: () => Promise.resolve(2),
      latestRound: () => Promise.resolve(at(2, 25n) as OracleRound),
      round: id => {
        reads++
        return Promise.resolve(at(Number(id >> 64n), id & ((1n << 64n) - 1n)))
      }
    }
  }
}

describe('when reading the phases of the oracle', () => {
  it('should find where a finished phase ended and where the current one stands', async () => {
    const { reader } = fakeOracle()

    const phases = await readPhases(reader)

    expect(phases.map(p => [p.phase, p.lastIndex])).toEqual([
      [1, 40n],
      [2, 25n]
    ])
  })
})

describe('when finding the round that closed a moment', () => {
  describe('and the moment falls inside a phase', () => {
    it('should return the last round written at or before it', async () => {
      const { reader } = fakeOracle()
      const phases = await readPhases(reader)

      expect((await roundAtOrBefore(reader, phases, 1000 + 1750))?.answer).toBe(1017n)
    })
  })

  describe('and the moment falls between two phases', () => {
    it('should return the last round of the earlier phase', async () => {
      const { reader } = fakeOracle()
      const phases = await readPhases(reader)

      expect((await roundAtOrBefore(reader, phases, 9_000))?.answer).toBe(1040n)
    })
  })

  describe('and the moment is before the oracle started', () => {
    it('should return nothing', async () => {
      const { reader } = fakeOracle()
      const phases = await readPhases(reader)

      expect(await roundAtOrBefore(reader, phases, 500)).toBeNull()
    })
  })

  describe('and the search resumes from a previous day', () => {
    it('should read fewer rounds than a search from the start', async () => {
      const { reader, reads } = fakeOracle()
      const phases = await readPhases(reader)
      const before = reads()
      await roundAtOrBefore(reader, phases, 1000 + 3950)
      const cold = reads() - before

      const warmStart = reads()
      await roundAtOrBefore(reader, phases, 1000 + 3950, { phase: 1, index: 38n })

      expect(reads() - warmStart).toBeLessThan(cold)
    })
  })
})

describe('when writing an oracle answer as a decimal', () => {
  it.each([
    [9320295n, 8, '0.09320295'],
    [72059881n, 8, '0.72059881'],
    [150000000n, 8, '1.5'],
    [0n, 8, '0']
  ])('should write %s at %s decimals as %s', (answer, decimals, expected) => {
    expect(toDecimal(answer, decimals)).toBe(expected)
  })
})
