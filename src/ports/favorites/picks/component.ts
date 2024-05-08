import SQL, { SQLStatement } from 'sql-template-strings'
import { isErrorWithMessage } from '../../../logic/errors'
import { AppComponents } from '../../../types'
import { insertVPQuery } from '../vp/queries'
import { DEFAULT_VOTING_POWER } from './constants'
import { DBGetFilteredPicksWithCount, DBPickStats, GetPicksByItemIdParameters, IPicksComponent, PickUnpickInBulkBody } from './types'

export function createPicksComponent(
  components: Pick<AppComponents, 'favoritesDatabase' | 'items' | 'lists' | 'snapshot' | 'logs'>
): IPicksComponent {
  const { favoritesDatabase: pg, items, snapshot, logs, lists } = components
  const logger = logs.getLogger('Picks component')

  /**
   * Gets the picks stats of a set of items.
   * @param itemIds - The ids of the items to get the stats likes for.
   * @param options - The userAddress to get check for a favorite from the user and
   * the power to count votes from user with a voting power greater than the provided number.
   * @returns One stats entry for each given item id, including the items who's votes are zero.
   */
  async function getPicksStats(itemIds: string[], options?: { userAddress?: string; power?: number }): Promise<DBPickStats[]> {
    const checkIfUserLikedTheItem = Boolean(options?.userAddress)

    const query = SQL`SELECT COUNT(DISTINCT favorites.picks.user_address), items_to_find.item_id AS item_id`
    if (checkIfUserLikedTheItem) {
      query.append(
        SQL`, MAX(CASE WHEN favorites.picks.user_address = ${options?.userAddress} THEN 1 ELSE 0 END)::BOOLEAN AS picked_by_user`
      )
    }

    query.append(
      SQL` FROM favorites.picks
      JOIN favorites.voting ON favorites.picks.user_address = favorites.voting.user_address AND (favorites.voting.power >= ${
        options?.power ?? DEFAULT_VOTING_POWER
      }`
    )
    if (options?.userAddress) {
      query.append(SQL` OR favorites.picks.user_address = ${options.userAddress}`)
    }
    query.append(SQL`) RIGHT JOIN (SELECT unnest(${itemIds}::text[]) AS item_id) AS items_to_find ON favorites.picks.item_id = items_to_find.item_id
      GROUP BY (items_to_find.item_id, favorites.picks.item_id)`)

    const result = await pg.query<DBPickStats>(query)
    return result.rows
  }

  async function getPicksByItemId(itemId: string, options: GetPicksByItemIdParameters): Promise<DBGetFilteredPicksWithCount[]> {
    const { limit, offset, power, userAddress } = options
    const query = SQL`SELECT user_address, COUNT(*) OVER() as picks_count`

    if (userAddress) {
      query.append(SQL`, user_address = ${userAddress} AS picked_by_user`)
    } else {
      query.append(SQL`, false AS picked_by_user`)
    }

    query.append(
      SQL` FROM (
        SELECT DISTINCT ON (favorites.picks.user_address)
          favorites.picks.user_address, favorites.picks.created_at
        FROM favorites.picks, favorites.voting
        WHERE favorites.picks.item_id = ${itemId}
        AND favorites.voting.user_address = favorites.picks.user_address AND (favorites.voting.power >= ${power ?? DEFAULT_VOTING_POWER}`
    )
    if (userAddress) {
      query.append(SQL` OR favorites.picks.user_address = ${userAddress}`)
    }
    query.append(SQL`)) AS temp
      ORDER BY picked_by_user DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}`)

    const result = await pg.query<DBGetFilteredPicksWithCount>(query)
    return result.rows
  }

  async function pickAndUnpickInBulk(itemId: string, body: PickUnpickInBulkBody, userAddress: string): Promise<void> {
    const { pickedFor = [], unpickedFrom = [] } = body
    let vpQuery: SQLStatement | undefined

    await Promise.all([items.validateItemExists(itemId), lists.checkNonEditableLists([...pickedFor, ...unpickedFrom], userAddress)])

    if (pickedFor && pickedFor.length > 0) {
      let power: number | undefined

      try {
        power = await snapshot.getScore(userAddress)
        logger.info(`The voting power for ${userAddress} will be updated to ${power}`)
      } catch (error) {
        logger.error(`Querying snapshot failed: ${isErrorWithMessage(error) ? error.message : 'Unknown'}`)
      }

      vpQuery = insertVPQuery(power, userAddress)
    }

    await pg.withTransaction(async client => {
      const pickForListsQuery =
        pickedFor.length &&
        SQL`INSERT INTO favorites.picks (item_id, user_address, list_id) SELECT ${itemId}, ${userAddress}, id AS list_id FROM favorites.lists WHERE id = ANY(${pickedFor})`

      const unpickFromListsQuery =
        unpickedFrom.length &&
        SQL`DELETE FROM favorites.picks WHERE item_id = ${itemId} AND user_address = ${userAddress} AND list_id = ANY(${unpickedFrom})`

      await Promise.all([pickForListsQuery, unpickFromListsQuery, vpQuery].map(query => query && client.query(query)))
    })
  }

  return { getPicksStats, getPicksByItemId, pickAndUnpickInBulk }
}
