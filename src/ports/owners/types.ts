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
}
