import { DBGetFilteredPicksWithCount, DBPickStats, PickStats } from '../../ports/favorites/picks'
import { PickUserAddressesWithCount } from './types'

export function fromDBGetPickByItemIdToPickUserAddressesWithCount(
  dBGetPicksByListId: DBGetFilteredPicksWithCount[]
): PickUserAddressesWithCount {
  return {
    picks: dBGetPicksByListId.map(pick => ({
      userAddress: pick.user_address
    })),
    count: Number(dBGetPicksByListId[0]?.picks_count ?? 0)
  }
}

/**
 * Converts a DB retrieved Pick Stats to a Pick Stats.
 * @param dbPickStat - The pick stats to convert from.
 */
export function fromDBPickStatsToPickStats(dbPickStat: DBPickStats): PickStats {
  const stats: PickStats = {
    itemId: dbPickStat.item_id,
    count: Number(dbPickStat.count)
  }

  if (dbPickStat.picked_by_user !== undefined) {
    stats.pickedByUser = dbPickStat.picked_by_user
  }

  return stats
}
