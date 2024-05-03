import SQL from 'sql-template-strings'
import { isErrorWithMessage } from '../../../logic/errors'
import { DEFAULT_LIST_USER_ADDRESS } from '../../../migrations/favorites/1678303321034_default-list'
import { AppComponents } from '../../../types'
import { Permission } from '../access'
import { deleteAccessQuery, insertAccessQuery } from '../access/queries'
import { DBGetFilteredPicksWithCount, DBPick } from '../picks'
import { ScoreError } from '../snapshot/errors'
import { insertVPQuery } from '../vp/queries'
import { GRANTED_TO_ALL } from './constants'
import { ListNotFoundError, ListsNotFoundError, PickAlreadyExistsError, PickNotFoundError } from './errors'
import { getListQuery } from './queries'
import {
  GetAuthenticatedAndPaginatedParameters,
  IListsComponents,
  DBList,
  DBGetListsWithCount,
  GetListsParameters,
  ListSortBy,
  ListSortDirection,
  GetListOptions,
  DBListsWithItemsCount,
  UpdateListRequestBody,
  NewList
} from './types'
import { validateDuplicatedListName, validateListExists } from './utils'

export function createListsComponent(
  components: Pick<AppComponents, 'favoritesDatabase' | 'snapshot' | 'logs' | 'items'>
): IListsComponents {
  const { favoritesDatabase: pg, items, snapshot, logs } = components
  const logger = logs.getLogger('Lists component')

  async function getPicksByListId(listId: string, params: GetAuthenticatedAndPaginatedParameters): Promise<DBGetFilteredPicksWithCount[]> {
    const { userAddress, limit, offset } = params
    const result = await pg.query<DBGetFilteredPicksWithCount>(SQL`
        SELECT DISTINCT(p.item_id), p.*, COUNT(*) OVER() as picks_count FROM favorites.picks p
        LEFT JOIN favorites.acl ON p.list_id = favorites.acl.list_id
        WHERE p.list_id = ${listId} AND (p.user_address = ${userAddress} OR favorites.acl.grantee = ${userAddress} OR favorites.acl.grantee = ${GRANTED_TO_ALL})
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
    `)
    return result.rows
  }

  async function getList(listId: string, options: GetListOptions): Promise<DBListsWithItemsCount> {
    const query = getListQuery(listId, options)

    const result = await pg.query<DBListsWithItemsCount>(query)

    if (result.rowCount === 0) {
      throw new ListNotFoundError(listId)
    }

    return result.rows[0]
  }

  async function addPickToList(listId: string, itemId: string, userAddress: string): Promise<DBPick> {
    const list = await getList(listId, { userAddress, requiredPermission: Permission.EDIT })
    let power: number | undefined

    try {
      ;[power] = await Promise.all([snapshot.getScore(userAddress), items.validateItemExists(itemId)])
      logger.info(`The voting power for ${userAddress} will be updated to ${power}`)
    } catch (error) {
      if (error instanceof ScoreError) logger.error(`Querying snapshot failed: ${isErrorWithMessage(error) ? error.message : 'Unknown'}`)
      else throw error
    }

    const vpQuery = insertVPQuery(power, userAddress)

    return pg.withTransaction(
      async client => {
        const results = await Promise.all([
          client.query<DBPick>(
            SQL`INSERT INTO favorites.picks (item_id, user_address, list_id) VALUES (${itemId}, ${userAddress}, ${list.id}) RETURNING *`
          ),
          client.query(vpQuery)
        ])

        return results[0].rows[0]
      },
      (error: unknown) => {
        if (
          error &&
          typeof error === 'object' &&
          'constraint' in error &&
          error.constraint === 'item_id_user_address_list_id_primary_key'
        ) {
          throw new PickAlreadyExistsError(listId, itemId)
        }

        throw new Error("The pick couldn't be created")
      }
    )
  }

  async function deletePickInList(listId: string, itemId: string, userAddress: string): Promise<void> {
    const result = await pg.query(
      SQL`DELETE FROM favorites.picks
      WHERE favorites.picks.list_id = ${listId}
      AND favorites.picks.item_id = ${itemId}
      AND favorites.picks.user_address = ${userAddress}`
    )
    if (result.rowCount === 0) {
      throw new PickNotFoundError(listId, itemId)
    }
  }

  async function getLists(params: GetListsParameters): Promise<DBGetListsWithCount[]> {
    const { userAddress, limit, offset, sortBy = ListSortBy.CREATED_AT, sortDirection = ListSortDirection.DESC, itemId, q } = params
    const query = SQL`SELECT l.*, COUNT(*) OVER() as lists_count, l.user_address = ${DEFAULT_LIST_USER_ADDRESS} as is_default_list, COUNT(p.item_id) AS items_count,
      (ARRAY_REMOVE(ARRAY_AGG(p.item_id ORDER BY p.created_at), NULL))[:4] preview_of_item_ids,
      (SELECT COUNT(1) FROM favorites.acl WHERE favorites.acl.list_id = l.id AND (favorites.acl.grantee = ${userAddress} OR favorites.acl.grantee = ${GRANTED_TO_ALL})) = 0 AS is_private`

    if (itemId) query.append(SQL`, MAX(CASE WHEN p.item_id = ${itemId} THEN 1 ELSE 0 END)::BOOLEAN AS is_item_in_list`)

    query.append(SQL`
      FROM favorites.lists l
      LEFT JOIN favorites.picks p ON l.id = p.list_id AND p.user_address = ${userAddress}
      WHERE l.user_address = ${userAddress} OR l.user_address = ${DEFAULT_LIST_USER_ADDRESS}`)

    if (q) {
      query.append(SQL` AND l.name ILIKE '%${q}%'`)
    }

    const orderByQuery = SQL`\nORDER BY is_default_list DESC`
    // Converts the sort direction into a explicit string to avoid using the SQL statement
    const sortDirectionKeyword = ListSortDirection.DESC === sortDirection ? 'DESC' : 'ASC'

    switch (sortBy) {
      case ListSortBy.CREATED_AT:
        orderByQuery.append(`, l.created_at ${sortDirectionKeyword}`)
        break
      case ListSortBy.UPDATED_AT:
        orderByQuery.append(`, l.updated_at ${sortDirectionKeyword} NULLS LAST`)
        break
      case ListSortBy.NAME:
        orderByQuery.append(`, l.name ${sortDirectionKeyword}`)
        break
    }

    query.append(SQL`\nGROUP BY l.id`)
    query.append(orderByQuery)
    query.append(SQL`\nLIMIT ${limit} OFFSET ${offset}`)

    const result = await pg.query<DBGetListsWithCount>(query)
    return result.rows
  }

  async function addList({ name, description, userAddress, private: isPrivate }: NewList): Promise<DBList> {
    return pg.withTransaction(
      async client => {
        const insertionResult = await client.query<DBList>(
          SQL`INSERT INTO favorites.lists (name, description, user_address) VALUES (${name}, ${
            description ?? null
          }, ${userAddress}) RETURNING *`
        )

        const insertedList = insertionResult.rows[0]
        const { id } = insertedList

        if (!isPrivate) {
          await client.query(insertAccessQuery(id, Permission.VIEW, GRANTED_TO_ALL))
        }

        return { ...insertedList, is_private: isPrivate }
      },
      (error: unknown) => {
        validateDuplicatedListName(name, error)

        throw new Error("The list couldn't be created")
      }
    )
  }

  async function updateList(id: string, userAddress: string, updatedList: UpdateListRequestBody): Promise<DBList> {
    const { name, description, private: isPrivate } = updatedList
    const shouldUpdate = name || description

    const accessQuery = isPrivate
      ? deleteAccessQuery(id, Permission.VIEW, GRANTED_TO_ALL, userAddress)
      : insertAccessQuery(id, Permission.VIEW, GRANTED_TO_ALL)

    return pg.withTransaction(
      async client => {
        const updateQuery = SQL`UPDATE favorites.lists SET `

        if (name) updateQuery.append(SQL`name = ${name}`)
        if (name && description) updateQuery.append(SQL`, `)
        if (description) updateQuery.append(SQL`description = ${description}`)

        updateQuery.append(SQL` WHERE id = ${id} AND user_address = ${userAddress} RETURNING *`)

        const [updateResult] = await Promise.all([shouldUpdate && client.query<DBList>(updateQuery), client.query(accessQuery)])
        const updatedListResult = await client.query<DBList>(getListQuery(id, { userAddress }))

        validateListExists(id, updateResult || updatedListResult)

        return updatedListResult.rows[0]
      },
      (error: unknown) => {
        if (error instanceof ListNotFoundError) throw error

        if (name) validateDuplicatedListName(name, error)

        throw new Error("The list couldn't be updated")
      }
    )
  }

  async function deleteList(id: string, userAddress: string): Promise<void> {
    const result = await pg.query(
      SQL`DELETE FROM favorites.lists
      WHERE favorites.lists.id = ${id}
      AND favorites.lists.user_address = ${userAddress}`
    )

    validateListExists(id, result)
  }

  async function checkNonEditableLists(listIds: string[], userAddress: string): Promise<void> {
    const { rows, rowCount } = await pg.query<Pick<DBList, 'id'>>(SQL`SELECT favorites.lists.id FROM favorites.lists
      LEFT JOIN favorites.acl ON favorites.lists.id = favorites.acl.list_id
      WHERE favorites.lists.id = ANY(${listIds}) AND favorites.lists.user_address != ${userAddress}
      AND (favorites.acl.permission != ${Permission.EDIT} OR favorites.acl.grantee NOT IN (${userAddress}, ${GRANTED_TO_ALL}))`)
    if (rowCount > 0) {
      throw new ListsNotFoundError(rows.map(({ id }) => id))
    }
  }

  return { getPicksByListId, addPickToList, deletePickInList, getLists, addList, deleteList, getList, updateList, checkNonEditableLists }
}
