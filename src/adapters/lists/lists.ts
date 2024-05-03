import { Permission } from '../../ports/favorites/access'
import { DBGetListsWithCount, DBList, DBListsWithItemsCount } from '../../ports/favorites/lists'
import { DBPick, DBGetFilteredPicksWithCount } from '../../ports/favorites/picks'
import { TPick } from '../picks'
import { ListsWithCount, List, PickIdsWithCount, ListWithItemsCount } from './types'

export function fromDBGetPickByListIdToPickIdsWithCount(dBGetPicksByListId: DBGetFilteredPicksWithCount[]): PickIdsWithCount {
  return {
    picks: dBGetPicksByListId.map(pick => ({
      itemId: pick.item_id,
      createdAt: Number(pick.created_at)
    })),
    count: Number(dBGetPicksByListId[0]?.picks_count ?? 0)
  }
}

export function fromDBPickToPick(dbPick: DBPick): TPick {
  return {
    itemId: dbPick.item_id,
    userAddress: dbPick.user_address,
    listId: dbPick.list_id,
    createdAt: Number(dbPick.created_at)
  }
}

export function fromDBGetListsToListsWithCount(dbLists: DBGetListsWithCount[]): ListsWithCount {
  return {
    lists: dbLists.map(list => {
      const { id, name, description, itemsCount, isPrivate, previewOfItemIds } = fromDBListWithItemsCountToListWithItemsCount(list)
      return {
        id,
        name,
        description,
        itemsCount,
        isItemInList: list.is_item_in_list,
        isPrivate,
        previewOfItemIds
      }
    }),
    count: Number(dbLists[0]?.lists_count ?? 0)
  }
}

export function fromDBListToList(dbList: DBList): List {
  return {
    id: dbList.id,
    name: dbList.name,
    description: dbList.description,
    userAddress: dbList.user_address,
    createdAt: Number(dbList.created_at),
    updatedAt: Number(dbList.updated_at),
    permission: dbList.permission as Permission,
    isPrivate: dbList.is_private,
    previewOfItemIds: dbList.preview_of_item_ids
  }
}

export function fromDBListWithItemsCountToListWithItemsCount(dbList: DBListsWithItemsCount): ListWithItemsCount {
  return {
    ...fromDBListToList(dbList),
    itemsCount: Number(dbList.items_count ?? 0)
  }
}
