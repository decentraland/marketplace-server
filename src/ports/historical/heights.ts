import { AppComponents } from '../../types'
import { getIndexedHeightQuery, getLiveSchemaQuery } from './queries'

/** The squids past holdings are read from. */
export type Squid = 'marketplace' | 'registry'

/** The chains past holdings are read on. */
export type Chain = 'ethereum' | 'polygon'

/** Each squid's processor for a chain keeps its state in `<prefix><deployment schema>`. */
const STATE_SCHEMA_PREFIX: Record<Squid, Partial<Record<Chain, string>>> = {
  marketplace: { ethereum: 'eth_processor_' },
  registry: { ethereum: 'ethereum_processor_', polygon: 'polygon_processor_' }
}

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
    if (!prefix) throw new Error(`the ${squid} squid does not index ${chain}`)
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
