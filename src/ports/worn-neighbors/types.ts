/** The items co-wear is computed over: anchors may be any catalogued item, neighbours only candidates. */
export type WornNeighborsCatalogue = {
  anchorIds: string[]
  candidateIds: string[]
}

/** An item worn together with an anchor item, among the anchor's strongest partners. */
export type WornNeighbor = {
  /** The anchor, as `contract-itemId`. */
  itemId: string
  /** The item worn with it, as `contract-itemId`. */
  neighborId: string
  /** Cosine similarity, `n(A,B) / √(n(A) × n(B))`. */
  sim: number
  /** Profiles wearing both. */
  support: number
  /** Position among the anchor's partners, strongest first, from 0. */
  rank: number
}

export interface IWornNeighborsComponent {
  /**
   * Computes the co-wear neighbours in the asset-bundle-registry database and yields them in batches
   * as the cursor reads them, so the full set never exists in memory at once. The next batch is only
   * read once the caller asks for it.
   *
   * @throws WornNeighborsUnavailableError when the registry cannot be read.
   */
  getNeighbors(catalogue: WornNeighborsCatalogue): AsyncGenerator<WornNeighbor[], void, undefined>
}
