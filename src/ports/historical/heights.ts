import { AppComponents } from '../../types'
import { getIndexedHeightQuery, getLiveSchemaQuery } from './queries'

/** The squids past holdings are read from. */
export type Squid = 'marketplace' | 'registry'

/** Each squid's Ethereum processor keeps its state in `<prefix><deployment schema>`. */
const STATE_SCHEMA_PREFIX: Record<Squid, string> = {
  marketplace: 'eth_processor_',
  registry: 'ethereum_processor_'
}

/** A squid's height is read again after this: it moves a block every 12 seconds. */
export const INDEXED_HEIGHT_TTL_MS = 15000

/**
 * How far each squid has indexed Ethereum: the height its live deployment's processor reached. A block
 * the squid has not reached yet must not be read, or the holdings would be missing its transfers.
 * Throws when the height cannot be read (a squid not deployed, or its state not readable).
 */
export function createIndexedHeights(
  dappsDatabase: Pick<AppComponents, 'dappsDatabase'>['dappsDatabase'],
  now: () => number = Date.now
): (squid: Squid) => Promise<number> {
  const heights = new Map<Squid, { readAt: number; height: Promise<number> }>()

  async function read(squid: Squid): Promise<number> {
    const live = await dappsDatabase.query<{ schema: string }>(getLiveSchemaQuery(squid))
    if (!live.rows.length) throw new Error(`there is no live ${squid} squid`)
    const { rows } = await dappsDatabase.query<{ height: number | string | null }>(
      getIndexedHeightQuery(`${STATE_SCHEMA_PREFIX[squid]}${live.rows[0].schema}`)
    )
    if (rows[0]?.height === null || rows[0]?.height === undefined) throw new Error(`the ${squid} squid has not indexed any block yet`)
    return Number(rows[0].height)
  }

  return squid => {
    const known = heights.get(squid)
    if (known && now() - known.readAt < INDEXED_HEIGHT_TTL_MS) return known.height
    const height = read(squid)
    heights.set(squid, { readAt: now(), height })
    height.catch(() => heights.get(squid)?.height === height && heights.delete(squid))
    return height
  }
}
