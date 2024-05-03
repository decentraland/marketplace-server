import { Permission } from '../../ports/favorites/access'
import { TPick } from '../picks'

export type PickIdsWithCount = { picks: Pick<TPick, 'itemId' | 'createdAt'>[]; count: number }

export type List = {
  id: string
  name: string
  description: string | null
  userAddress: string
  createdAt: number
  updatedAt: number | null
  permission?: Permission | null
  isPrivate: boolean
  previewOfItemIds?: string[]
}

export type ListWithItemsCount = List & {
  itemsCount: number
}

export type ListsWithCount = {
  lists: (Pick<ListWithItemsCount, 'id' | 'name' | 'description' | 'itemsCount' | 'isPrivate' | 'previewOfItemIds'> & {
    isItemInList?: boolean
  })[]
  count: number
}
