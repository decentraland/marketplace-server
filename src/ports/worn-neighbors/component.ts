import { AppComponents } from '../../types'
import { WornNeighborsUnavailableError } from './errors'
import { buildCoWornQuery } from './queries'
import { IWornNeighborsComponent, WornNeighbor, WornNeighborsCatalogue } from './types'

/** Rows fetched per round trip, and so per batch yielded. */
const BATCH_SIZE = 20_000

type CoWornRow = { item_id: string; neighbor_id: string; sim: number; support: string; rank: string }

export function createWornNeighborsComponent(
  components: Required<Pick<AppComponents, 'assetBundleRegistryDatabase'>>
): IWornNeighborsComponent {
  const { assetBundleRegistryDatabase } = components

  function toNeighbor(row: CoWornRow): WornNeighbor {
    return {
      itemId: row.item_id,
      neighborId: row.neighbor_id,
      sim: Number(row.sim),
      support: Number(row.support),
      rank: Number(row.rank)
    }
  }

  /**
   * Streams the query on the database component's own dedicated connection, which it opens for the
   * stream and closes when the stream ends, fails, or is abandoned by a caller that stops early.
   *
   * A caller that stops early never raises inside this generator (its loop calls `return`, not
   * `throw`), so everything the catch below sees is the registry's.
   */
  async function* getNeighbors(catalogue: WornNeighborsCatalogue): AsyncGenerator<WornNeighbor[], void, undefined> {
    let batch: WornNeighbor[] = []
    try {
      for await (const row of assetBundleRegistryDatabase.streamQuery<CoWornRow>(buildCoWornQuery(catalogue), { batchSize: BATCH_SIZE })) {
        batch.push(toNeighbor(row))
        if (batch.length >= BATCH_SIZE) {
          yield batch
          batch = []
        }
      }
    } catch (error) {
      throw new WornNeighborsUnavailableError(error)
    }
    if (batch.length > 0) yield batch
  }

  return { getNeighbors }
}
