import { Network } from '@dcl/schemas'

export type IAccountsComponent = {
  getAccounts(filters?: AccountFilters): Promise<{ data: Account[]; total: number }>
}

export enum AccountSortBy {
  MOST_SALES = 'most_sales',
  MOST_PURCHASES = 'most_purchases',
  MOST_ROYALTIES = 'most_royalties',
  MOST_COLLECTIONS = 'most_collections',
  MOST_EARNED = 'most_earned',
  MOST_SPENT = 'most_spent'
}

export type AccountFilters = {
  first?: number
  skip?: number
  sortBy?: AccountSortBy
  id?: string
  address?: string[]
  network?: Network
}

export type DBAccount = {
  id: string
  address: string
  sales: number
  purchases: number
  spent: string
  earned: string
  royalties: string
  collections: number
  count: number
}

export type Account = {
  id: string
  address: string
  sales: number
  purchases: number
  spent: string
  earned: string
  royalties: string
  collections: number
}
