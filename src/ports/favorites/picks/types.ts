import { PaginationParameters } from '../../../logic/http'

export interface IPicksComponent {
  /**
   * Gets the picks stats of a set of items.
   * @param itemIds - The ids of the items to get the stats likes for.
   * @param options - The userAddress to get check for a favorite from the user and
   * the power to count votes from user with a voting power greater than the provided number.
   * @returns One stats entry for each given item id, including the items who's votes are zero.
   */
  getPicksStats(itemId: string[], options?: ByUserAddressAndPower): Promise<DBPickStats[]>
  getPicksByItemId(itemId: string, options: GetPicksByItemIdParameters): Promise<DBGetFilteredPicksWithCount[]>
  pickAndUnpickInBulk(itemId: string, body: PickUnpickInBulkBody, userAddress: string): Promise<void>
}

export type DBPickStats = {
  picked_by_user?: boolean
  item_id: string
  count: string
}

export type PickStats = {
  pickedByUser?: boolean
  itemId: string
  count: number
}

export type ByUserAddressAndPower = {
  userAddress?: string
  power?: number
}

export type GetPicksByItemIdParameters = ByUserAddressAndPower & PaginationParameters

export type DBPick = {
  item_id: string
  user_address: string
  list_id: string
  created_at: Date
}

export type DBGetFilteredPicksWithCount = DBPick & {
  picks_count: string
}

export type PickUnpickInBulkBody = {
  pickedFor?: string[]
  unpickedFrom?: string[]
}

export type PickUnpickInBulkResponse = {
  pickedByUser?: boolean
}
