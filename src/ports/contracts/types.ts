import { Contract, Network, NFTCategory } from '@dcl/schemas'
import { SquidNetwork } from '../../types'

export type IContractsComponent = {
  getContracts(filters?: ContractFilters): Promise<{ data: Contract[]; total: number }>
  getMarketplaceContracts(): Contract[]
  getCollectionContracts(filters?: ContractFilters): Promise<{ data: Contract[]; total: number }>
  getAllCollectionContracts(filters?: ContractFilters): Promise<Contract[]>
}

export enum ContractSortBy {
  NAME = 'name'
}

export type ContractFilters = {
  first?: number
  skip?: number
  sortBy?: ContractSortBy
  category?: NFTCategory
  network?: Network
}

export type DBCollection = {
  id: string
  name: string
  chain_id: number
  network: SquidNetwork
  count: number
}
