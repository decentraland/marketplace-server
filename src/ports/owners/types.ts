export type Owner = {
  issuedId: string
  ownerId: string
  tokenId: string
}

export type OwnersFilters = {
  contractAddress: string
  itemId: string
  first?: number
  skip?: number
  orderDirection?: string
}

export enum OwnersSortBy {
  ISSUED_ID = 'issuedId'
}

export type OwnerDBRow = {
  issued_id: string
  owner: string
  token_id: string
}

export type OwnerCountDBRow = {
  count: string
}

export interface IOwnersComponent {
  fetchAndCount(
    filters: OwnersFilters & {
      sortBy?: OwnersSortBy
      first?: number
      skip?: number
    }
  ): Promise<{ data: Owner[]; total: number }>
  /**
   * Every account holding NFTs of a creator's items, ranked and paged.
   *
   * @param filters - The creator, and how to sort and page the result.
   * @returns The page of owners and how many owners there are in total.
   * @throws TopOwnersTimeoutError when the creator's catalogue is too large to aggregate in time.
   */
  fetchTopOwners(filters: TopOwnersFilters): Promise<{ data: TopOwner[]; total: number }>
}

/** One account holding NFTs of a creator's items, aggregated across all of that creator's collections. */
export type TopOwner = {
  address: string
  /** NFTs of the creator's items this account holds today. */
  nfts: number
  /** Distinct items among them. */
  items: number
  /** Distinct collections among them. */
  collections: number
  /** When the most recent of them reached this account, in milliseconds. */
  lastAcquiredAt: number
  /** What this account paid, in MANA wei, across every sale of the creator's items it bought, first sales and resales. */
  spentWei: string
}

export enum TopOwnersSortBy {
  NFTS = 'nfts',
  ITEMS = 'items',
  COLLECTIONS = 'collections',
  RECENT = 'recent',
  SPENT = 'spent'
}

export type TopOwnersFilters = {
  creator: string
  sortBy?: TopOwnersSortBy
  orderDirection?: 'asc' | 'desc'
  first?: number
  skip?: number
}

export type TopOwnerDBRow = {
  owner: string
  nfts: string
  items: string
  collections: string
  last_at: string
  spent: string
}
