import { PaginationParameters } from '../../../logic/http'
import { Permission } from '../access'
import { DBGetFilteredPicksWithCount, DBPick } from '../picks'

export interface IListsComponents {
  getPicksByListId(listId: string, options?: GetAuthenticatedAndPaginatedParameters): Promise<DBGetFilteredPicksWithCount[]>
  addPickToList(listId: string, itemId: string, userAddress: string): Promise<DBPick>
  deletePickInList(listId: string, itemId: string, userAddress: string): Promise<void>
  getLists(options?: GetListsParameters): Promise<DBGetListsWithCount[]>
  addList(newList: NewList): Promise<DBList>
  deleteList(id: string, userAddress: string): Promise<void>
  getList(listId: string, options?: GetListOptions): Promise<DBListsWithItemsCount>
  updateList(id: string, userAddress: string, updatedList: UpdateListRequestBody): Promise<DBList>
  checkNonEditableLists(listIds: string[], userAddress: string): Promise<void>
}

export type GetAuthenticatedAndPaginatedParameters = {
  userAddress?: string
} & PaginationParameters

export type GetListsParameters = PaginationParameters & {
  userAddress: string
  sortBy?: ListSortBy
  sortDirection?: ListSortDirection
  itemId?: string | null
  q?: string | null
}

export type GetListOptions = {
  userAddress?: string
  considerDefaultList?: boolean
  requiredPermission?: Permission
}

export type DBList = {
  id: string
  name: string
  description: string | null
  user_address: string
  created_at: Date
  updated_at: Date | null
  permission?: string | null
  is_private: boolean
  preview_of_item_ids?: string[]
}

export type DBListsWithItemsCount = DBList & {
  items_count: string
}

export type DBGetListsWithCount = DBListsWithItemsCount & {
  lists_count: string
  is_item_in_list?: boolean
}

export type AddItemToListBody = { itemId: string }

export type AddListRequestBody = {
  name: string
  description?: string
  private: boolean
}

export type UpdateListRequestBody = Partial<AddListRequestBody>

export type NewList = AddListRequestBody & {
  userAddress: string
}

export enum ListSortBy {
  CREATED_AT = 'createdAt',
  NAME = 'name',
  UPDATED_AT = 'updatedAt'
}

export enum ListSortDirection {
  ASC = 'asc',
  DESC = 'desc'
}
