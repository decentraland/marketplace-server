import { AppComponents } from '../../types'
import { SquidStateNotFoundError } from './errors'
import { getIndexedHeadQuery, getIndexedHeightQuery, getLiveSchemaQuery } from './queries'

/** The squids past holdings are read from. */
export type Squid = 'marketplace' | 'registry'

/** The chains past holdings are read on. */
export type Chain = 'ethereum' | 'polygon'

/**
 * A squid's processor: one per chain it indexes, named after it, and registry-squid's vesting contracts
 * in one of their own, on Ethereum, so that a contract anyone can create stops only them.
 */
export type Processor = Chain | 'vesting'

/** Each squid's processor keeps its state in `<prefix><deployment schema>`. */
const STATE_SCHEMA_PREFIX: Record<Squid, Partial<Record<Processor, string>>> = {
  marketplace: { ethereum: 'eth_processor_', polygon: 'polygon_processor_' },
  registry: { ethereum: 'ethereum_processor_', polygon: 'polygon_processor_', vesting: 'vesting_processor_' }
}

/** The chain a processor reads. */
const chainOf = (processor: Processor): Chain => (processor === 'vesting' ? 'ethereum' : processor)

/** A squid's height is read again after this: it moves a block every 12 seconds on Ethereum. */
export const INDEXED_HEIGHT_TTL_MS = 15000

/**
 * How far each squid has indexed a chain, Ethereum unless said otherwise: the height its live
 * deployment's processor for that chain reached, or only the finalized part of it. A block the squid
 * has not reached yet must not be read, or the holdings would be missing its transfers. Throws when the
 * height cannot be read (a squid not deployed, a chain it does not index, or its state not readable).
 */
export function createIndexedHeights(
  dappsDatabase: Pick<AppComponents, 'dappsDatabase'>['dappsDatabase'],
  now: () => number = Date.now
): (squid: Squid, chain?: Chain, finalized?: boolean) => Promise<number> {
  const heights = new Map<string, { readAt: number; height: Promise<number> }>()

  async function read(squid: Squid, chain: Chain, finalized: boolean): Promise<number> {
    const prefix = STATE_SCHEMA_PREFIX[squid][chain]
    if (!prefix) throw new SquidStateNotFoundError(`the ${squid} squid does not index ${chain}`)
    const live = await dappsDatabase.query<{ schema: string }>(getLiveSchemaQuery(squid))
    if (!live.rows.length) throw new Error(`there is no live ${squid} squid`)
    const { rows } = await dappsDatabase.query<{ height: number | string | null }>(
      getIndexedHeightQuery(`${prefix}${live.rows[0].schema}`, finalized)
    )
    if (rows[0]?.height === null || rows[0]?.height === undefined) {
      throw new Error(`the ${squid} squid has not indexed any block yet${chain === 'polygon' ? ' on Polygon' : ''}`)
    }
    return Number(rows[0].height)
  }

  return (squid, chain = 'ethereum', finalized = false) => {
    const key = `${squid}:${chain}:${finalized ? 'finalized' : 'indexed'}`
    const known = heights.get(key)
    if (known && now() - known.readAt < INDEXED_HEIGHT_TTL_MS) return known.height
    const height = read(squid, chain, finalized)
    heights.set(key, { readAt: now(), height })
    height.catch(() => heights.get(key)?.height === height && heights.delete(key))
    return height
  }
}

/** The block a squid's live deployment has indexed up to on a chain, as a subgraph's `_meta.block` reads. */
export type Head = {
  number: number
  hash: string
  /** Seconds, or null when the chain's RPC does not answer for the block's hash. */
  timestamp: number | null
}

/**
 * The head a squid's processor has indexed, the one for the chain unless said otherwise: its highest
 * hot block, or its finalized block when it holds none, with that block's hash and timestamp. The
 * timestamp is read by the hash, so it is that block's even when a reorg has replaced the block at
 * that height. The gateway answers a subgraph's `_meta` with it. Kept for `INDEXED_HEIGHT_TTL_MS`, as
 * the heights are. Throws when the head cannot be read.
 */
export function createIndexedHeads(
  dappsDatabase: Pick<AppComponents, 'dappsDatabase'>['dappsDatabase'],
  getBlockTimestamp: (chain: Chain, blockHash: string) => Promise<number | undefined>,
  now: () => number = Date.now
): (squid: Squid, chain: Chain, processor?: Processor) => Promise<Head> {
  const heads = new Map<string, { readAt: number; head: Promise<Head> }>()

  async function read(squid: Squid, chain: Chain, processor: Processor): Promise<Head> {
    const prefix = STATE_SCHEMA_PREFIX[squid][processor]
    if (!prefix || chainOf(processor) !== chain) {
      throw new SquidStateNotFoundError(`the ${squid} squid has no ${processor} processor on ${chain}`)
    }
    const live = await dappsDatabase.query<{ schema: string }>(getLiveSchemaQuery(squid))
    if (!live.rows.length) throw new Error(`there is no live ${squid} squid`)
    const { rows } = await dappsDatabase.query<{ height: number | string; hash: string }>(
      getIndexedHeadQuery(`${prefix}${live.rows[0].schema}`)
    )
    const number = rows.length ? Number(rows[0].height) : -1
    // A processor that has not committed its first batch yet holds the status it starts with, height -1.
    if (number < 0) throw new Error(`the ${squid} squid's ${processor} processor has not indexed any block yet`)
    const timestamp = await getBlockTimestamp(chain, rows[0].hash).catch(() => undefined)
    return { number, hash: rows[0].hash, timestamp: timestamp ?? null }
  }

  return (squid, chain, processor = chain) => {
    const key = `${squid}:${chain}:${processor}`
    const known = heads.get(key)
    if (known && now() - known.readAt < INDEXED_HEIGHT_TTL_MS) return known.head
    const head = read(squid, chain, processor)
    heads.set(key, { readAt: now(), head })
    // A failure, or a head the RPC gave no timestamp for, is not kept: the next request tries again.
    const forget = () => heads.get(key)?.head === head && heads.delete(key)
    head.then(({ timestamp }) => timestamp === null && forget(), forget)
    return head
  }
}
