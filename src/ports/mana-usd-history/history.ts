import { OracleReader, OracleRound } from './types'

const PHASE_SHIFT = 64n
const INDEX_MASK = (1n << PHASE_SHIFT) - 1n

export function roundId(phase: number, index: bigint): bigint {
  return (BigInt(phase) << PHASE_SHIFT) | index
}

export function indexOf(id: bigint): bigint {
  return id & INDEX_MASK
}

export type Phase = { phase: number; first: OracleRound; lastIndex: bigint }

/**
 * The index of a finished phase's last round.
 *
 * A finished phase does not say where it ended, so the end is found by doubling until a round is missing and
 * then bisecting back: about twice log2 of the phase's length in reads.
 */
async function lastIndexOf(reader: OracleReader, phase: number): Promise<bigint> {
  let known = 1n
  let probe = 2n
  while (await reader.round(roundId(phase, probe))) {
    known = probe
    probe *= 2n
  }
  let lo = known
  let hi = probe - 1n
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n
    if (await reader.round(roundId(phase, mid))) lo = mid
    else hi = mid - 1n
  }
  return lo
}

/** Every phase of the proxy with its first round and last index, oldest first. Phases with no rounds are skipped. */
export async function readPhases(reader: OracleReader): Promise<Phase[]> {
  const current = await reader.phaseId()
  const latest = await reader.latestRound()
  const phases: Phase[] = []
  for (let phase = 1; phase <= current; phase++) {
    const first = await reader.round(roundId(phase, 1n))
    if (!first) continue
    const lastIndex = phase === current ? indexOf(latest.id) : await lastIndexOf(reader, phase)
    phases.push({ phase, first, lastIndex })
  }
  return phases
}

/**
 * The last round written at or before `at` (seconds), or null when the oracle had not started yet.
 *
 * Round timestamps only grow within a phase and across phases, so this is one bisection inside the right
 * phase. `from` lets consecutive days resume where the previous one landed rather than from the start.
 */
export async function roundAtOrBefore(
  reader: OracleReader,
  phases: Phase[],
  at: number,
  from?: { phase: number; index: bigint }
): Promise<OracleRound | null> {
  const phase = [...phases].reverse().find(p => p.first.updatedAt <= at)
  if (!phase) return null
  let lo = from && from.phase === phase.phase ? from.index : 1n
  let hi = phase.lastIndex
  let best: OracleRound | null = null
  while (lo <= hi) {
    const mid = (lo + hi) / 2n
    const round = await reader.round(roundId(phase.phase, mid))
    if (round && round.updatedAt <= at) {
      best = round
      lo = mid + 1n
    } else {
      hi = mid - 1n
    }
  }
  return best ?? phase.first
}

/** A fixed-point answer as a decimal string, exactly: 9320295 at 8 decimals is "0.09320295". */
export function toDecimal(answer: bigint, decimals: number): string {
  const negative = answer < 0n
  const digits = (negative ? -answer : answer).toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}
