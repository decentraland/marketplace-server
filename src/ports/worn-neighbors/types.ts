import type { NeighborInsertRow } from '../../logic/suggestions/neighbors-table'

/** The items co-wear is computed over: anchors may be any catalogued item, neighbours only candidates. */
export type WornNeighborsCatalogue = {
  anchorIds: string[]
  candidateIds: string[]
}

export interface IWornNeighborsComponent {
  /**
   * Computes the co-wear neighbours in the asset-bundle-registry database and yields them in batches
   * as the cursor reads them, so the full set never exists in memory at once. The next batch is only
   * read once the caller asks for it.
   *
   * @throws WornNeighborsUnavailableError when the registry cannot be read.
   */
  getNeighbors(catalogue: WornNeighborsCatalogue): AsyncGenerator<NeighborInsertRow[], void, undefined>
}
