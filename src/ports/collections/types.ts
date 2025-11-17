import { Network } from '@dcl/schemas'
import { SquidNetwork } from '../../types'

export type ICollectionsComponent = {
  getCollections(filters?: CollectionFilters): Promise<{ data: Collection[]; total: number }>
}

export enum CollectionSortBy {
  NEWEST = 'newest',
  RECENTLY_REVIEWED = 'recently_reviewed',
  NAME = 'name',
  SIZE = 'size',
  RECENTLY_LISTED = 'recently_listed'
}

export type CollectionFilters = {
  first?: number
  skip?: number
  sortBy?: CollectionSortBy
  name?: string
  search?: string
  creator?: string
  urn?: string
  contractAddress?: string
  isOnSale?: boolean
  network?: Network
}

export type DBCollection = {
  id: string
  owner: string
  creator: string
  name: string
  symbol: string
  is_completed: boolean
  is_approved: boolean
  is_editable: boolean
  minters: string[]
  managers: string[]
  urn: string
  items_count: number
  created_at: number
  updated_at: number
  reviewed_at: number
  first_listed_at: number | null
  search_is_store_minter: boolean
  search_text: string
  base_uri: string
  chain_id: number
  network: SquidNetwork
  count: number
}

export type Collection = {
  urn: string
  creator: string
  name: string
  contractAddress: string
  createdAt: number
  updatedAt: number
  reviewedAt: number
  isOnSale: boolean
  size: number
  network: Network
  chainId: number
  firstListedAt: number | null
}

