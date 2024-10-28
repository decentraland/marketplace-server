import BN from 'bn.js'
import SQL, { SQLStatement } from 'sql-template-strings'
import {
  getUniqueCollectorsFromCollectorsDayData,
  getUniqueCreatorsFromCreatorsDayData,
  getUniqueItemsFromItemsDayData
} from '../../logic/rankings/utils'
import {
  RankingsFilters,
  RankingsSortBy,
  ItemsDayDataTimeframe,
  RankingEntity,
  RankingEntityResponse,
  ItemRank,
  CreatorRank,
  CollectorRank,
  RankingFragment,
  ItemsDayDataFragment,
  CollectorsDayDataFragment,
  CreatorsDayDataFragment
} from './types'

export const MAX_RESULTS = 1000

function getQueryParams(entity: RankingEntity, filters: RankingsFilters) {
  const { from, category, rarity, sortBy } = filters
  const conditions: SQLStatement[] = []

  if (entity === RankingEntity.WEARABLES) {
    conditions.push(SQL`search_emote_category IS NULL`)
  } else if (entity === RankingEntity.EMOTES) {
    conditions.push(SQL`search_wearable_category IS NULL`)
  }

  if (category) {
    conditions.push(
      entity === RankingEntity.WEARABLES ? SQL`search_wearable_category = ${category}` : SQL`search_emote_category = ${category}`
    )
  }

  if (entity === RankingEntity.CREATORS) {
    conditions.push(SQL`sales > 0`)
    if (from === 0) {
      conditions.push(SQL`collections > 0`)
    }
  } else if (entity === RankingEntity.COLLECTORS) {
    conditions.push(SQL`purchases > 0`)
  }

  if (rarity) {
    if (from === 0) {
      // if it fetches the Item entity
      conditions.push(SQL`rarity = ${rarity}`)
    } else {
      conditions.push(SQL`search_rarity = ${rarity}`)
    }
  }
  if (from) {
    conditions.push(SQL`date >= ${Math.round(from / 1000)}`)
  }

  let orderBy = 'volume'
  let orderDirection = 'desc'
  switch (sortBy) {
    case RankingsSortBy.MOST_SALES:
      if (entity === RankingEntity.COLLECTORS) {
        orderBy = 'purchases'
        orderDirection = 'desc'
      } else if (from === 0 && entity === RankingEntity.CREATORS) {
        orderBy = 'primary_sales'
        orderDirection = 'desc'
      } else {
        orderBy = 'sales'
        orderDirection = 'desc'
      }
      break
    case RankingsSortBy.MOST_VOLUME:
      if (entity === RankingEntity.COLLECTORS) {
        // for accounts the field is "spent"
        orderBy = 'spent'
        orderDirection = 'desc'
      } else if (entity === RankingEntity.CREATORS) {
        // for accounts the field is "earned"
        orderBy = from === 0 ? 'primary_sales_earned' : 'earned'
        orderDirection = 'desc'
      }
      break
  }

  const where = SQL``
  // const whereComplete = where.map(condition => finalWhere.append(condition))

  conditions.forEach((condition, index) => {
    if (condition) {
      where.append(condition)
      if (conditions[index + 1]) {
        where.append(SQL` AND `)
      }
    }
  })

  return { where, orderBy, orderDirection }
}

export function getRankingQuery(entity: RankingEntity, filters: RankingsFilters, page = 0) {
  switch (entity) {
    case RankingEntity.WEARABLES:
      return getItemsDayDataQuery(RankingEntity.WEARABLES, filters, page)
    case RankingEntity.EMOTES:
      return getItemsDayDataQuery(RankingEntity.EMOTES, filters, page)
    case RankingEntity.CREATORS:
      return getCreatorsDayDataQuery(filters, page)
    case RankingEntity.COLLECTORS:
      return getCollectorsDayDataQuery(filters, page)
  }
}

export function consolidateRankingResults(entity: RankingEntity, fragments: RankingFragment[], filters: RankingsFilters) {
  switch (entity) {
    case RankingEntity.WEARABLES:
    case RankingEntity.EMOTES:
      return getUniqueItemsFromItemsDayData(fragments as ItemsDayDataFragment[], filters)
    case RankingEntity.CREATORS:
      return getUniqueCreatorsFromCreatorsDayData(fragments as CreatorsDayDataFragment[])
    case RankingEntity.COLLECTORS:
      return getUniqueCollectorsFromCollectorsDayData(fragments as CollectorsDayDataFragment[])
  }
}

export function getItemsDayDataQuery(entity: RankingEntity, filters: RankingsFilters, page = 0) {
  const { where, orderBy, orderDirection } = getQueryParams(entity, filters)

  return filters.from === 0
    ? SQL`
      SELECT id, sales, volume
      FROM items
      WHERE `
        .append(where)
        .append(
          SQL`
      ORDER BY `
            .append(orderBy)
            .append(orderDirection).append(SQL`
      ${filters.first ? SQL`LIMIT ${filters.first}` : SQL``}
    `)
        )
    : SQL`
      SELECT id, sales, volume
      FROM squid_marketplace.items_day_data
      WHERE `
        .append(where)
        .append(
          SQL`
      ORDER BY `
            .append(orderBy)
            .append(SQL` `)
            .append(orderDirection).append(SQL`
      LIMIT ${MAX_RESULTS}
      OFFSET ${MAX_RESULTS * page}
    `)
        )
}

export function getDateXDaysAgo(numOfDays: number, date = new Date()) {
  const daysAgo = new Date(date.getTime())

  daysAgo.setDate(date.getDate() - numOfDays)

  return daysAgo
}

export function getTimestampFromTimeframe(timeframe: ItemsDayDataTimeframe) {
  switch (timeframe) {
    case ItemsDayDataTimeframe.DAY:
      return getDateXDaysAgo(1).getTime()
    case ItemsDayDataTimeframe.WEEK:
      return getDateXDaysAgo(7).getTime()
    case ItemsDayDataTimeframe.MONTH:
      return getDateXDaysAgo(30).getTime()
    case ItemsDayDataTimeframe.ALL:
      return 0
    default:
      return 0
  }
}

// Creators
export function getCreatorsDayDataQuery(filters: RankingsFilters, page = 0) {
  const { where, orderBy, orderDirection } = getQueryParams(RankingEntity.CREATORS, filters)

  return filters.from === 0
    ? SQL`
      SELECT id, sales, earned, unique_collections_sales, unique_collectors_total
      FROM accounts
      WHERE `.append(where).append(SQL`
      ORDER BY ${orderBy} ${orderDirection}
      ${filters.first ? SQL`LIMIT ${filters.first}` : SQL``}
    `)
    : SQL`
      SELECT id, sales, earned, unique_collections_sales, unique_collectors_total
      FROM accounts_day_data
      WHERE `.append(where).append(SQL`
      ORDER BY ${orderBy} ${orderDirection}
      LIMIT ${MAX_RESULTS}
      OFFSET ${MAX_RESULTS * page}
    `)
}

// Collectors
export function getCollectorsDayDataQuery(filters: RankingsFilters, page = 0) {
  const { where, orderBy, orderDirection } = getQueryParams(RankingEntity.COLLECTORS, filters)

  return filters.from === 0
    ? SQL`
      SELECT id, purchases, spent, unique_and_mythic_items, creators_supported_total
      FROM accounts
      WHERE `.append(where).append(SQL`
      ORDER BY ${orderBy} ${orderDirection}
      ${filters.first ? SQL`LIMIT ${filters.first}` : SQL``}
    `)
    : SQL`
      SELECT id, purchases, spent, unique_and_mythic_items, creators_supported_total
      FROM accounts_day_data
      WHERE `.append(where).append(SQL`
      ORDER BY ${orderBy} ${orderDirection}
      LIMIT ${MAX_RESULTS}
      OFFSET ${MAX_RESULTS * page}
    `)
}

export function sortRankResults(
  entity: RankingEntity,
  ranks: RankingEntityResponse[],
  sortBy: RankingsSortBy = RankingsSortBy.MOST_VOLUME
): RankingEntityResponse[] {
  switch (entity) {
    case RankingEntity.EMOTES:
    case RankingEntity.WEARABLES:
      return (ranks as ItemRank[]).sort((a: ItemRank, b: ItemRank) =>
        sortBy === RankingsSortBy.MOST_SALES ? b.sales - a.sales : new BN(a.volume).lt(new BN(b.volume)) ? 1 : -1
      )
    case RankingEntity.CREATORS:
      return (ranks as CreatorRank[]).sort((a: CreatorRank, b: CreatorRank) =>
        sortBy === RankingsSortBy.MOST_SALES ? b.sales - a.sales : new BN(a.earned).lt(new BN(b.earned)) ? 1 : -1
      )
    case RankingEntity.COLLECTORS:
      return (ranks as CollectorRank[]).sort((a: CollectorRank, b: CollectorRank) =>
        sortBy === RankingsSortBy.MOST_SALES ? b.purchases - a.purchases : new BN(a.spent).lt(new BN(b.spent)) ? 1 : -1
      )
  }
}
