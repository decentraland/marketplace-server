import type { NeighborInsertRow } from '../../logic/suggestions/neighbors-table'

/** The items co-wear is computed over: anchors may be any catalogued item, neighbours only candidates. */
export type WornNeighborsCatalogue = {
  anchorIds: string[]
  candidateIds: string[]
}

export interface IWornNeighborsComponent {
  /**
   * Computes the co-wear neighbours in the asset-bundle-registry database and streams them into
   * `insert` as they arrive, so the full set never exists in memory at once. Returns how many rows were
   * written.
   *
   * @throws WornNeighborsUnavailableError when the registry cannot be read. An error thrown by `insert`
   * is rethrown as is.
   */
  streamNeighbors(catalogue: WornNeighborsCatalogue, insert: (rows: NeighborInsertRow[]) => Promise<void>): Promise<number>
}
