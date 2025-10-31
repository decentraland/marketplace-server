import { AppComponents } from '../../types'
import {
  fromDbRowsToWearables,
  fromDbRowsToEmotes,
  fromDbRowsToNames,
  fromDbRowsToGroupedWearables,
  fromDbRowsToGroupedEmotes
} from './mappers'
import {
  getWearablesByOwnerQuery,
  getWearablesByOwnerCountQuery,
  getWearablesByOwnerUniqueItemsCountQuery,
  getOwnedWearablesUrnAndTokenIdQuery,
  getEmotesByOwnerQuery,
  getEmotesByOwnerCountQuery,
  getEmotesByOwnerUniqueItemsCountQuery,
  getOwnedEmotesUrnAndTokenIdQuery,
  getNamesByOwnerQuery,
  getNamesByOwnerCountQuery,
  getOwnedNamesOnlyQuery,
  getGroupedWearablesByOwnerQuery,
  getGroupedWearablesByOwnerCountQuery,
  getGroupedEmotesByOwnerQuery,
  getGroupedEmotesByOwnerCountQuery
} from './queries'
import {
  IUserAssetsComponent,
  ProfileWearable,
  ProfileEmote,
  ProfileName,
  DappsDbRow,
  GroupedWearable,
  GroupedEmote,
  UserAssetsFilters
} from './types'

const FIRST_DEFAULT = 100
const SKIP_DEFAULT = 0

export async function createUserAssetsComponent(components: Pick<AppComponents, 'logs' | 'dappsDatabase'>): Promise<IUserAssetsComponent> {
  const { logs, dappsDatabase } = components
  const logger = logs.getLogger('user-assets')

  /**
   * Gets complete wearable data for a user - used by wearables endpoint
   * Returns full wearable information including metadata, rarity, pricing, etc.
   *
   * @param owner - Ethereum address of the wearable owner
   * @param first - Maximum number of wearables to return (default: 100)
   * @param skip - Number of wearables to skip (default: 0)
   * @returns Promise resolving to object with data array, total count, and total unique items
   */
  async function getWearablesByOwner(
    owner: string,
    first = FIRST_DEFAULT,
    skip = SKIP_DEFAULT
  ): Promise<{ data: ProfileWearable[]; total: number; totalItems: number }> {
    try {
      const client = await dappsDatabase.getPool().connect()

      try {
        const [dataQuery, countQuery, uniqueItemsQuery] = [
          getWearablesByOwnerQuery(owner, first, skip),
          getWearablesByOwnerCountQuery(owner),
          getWearablesByOwnerUniqueItemsCountQuery(owner)
        ]

        const [dataResult, countResult, uniqueItemsResult] = await Promise.all([
          client.query<DappsDbRow>(dataQuery),
          client.query<{ total: string }>(countQuery),
          client.query<{ total_items: string }>(uniqueItemsQuery)
        ])

        const total = parseInt(countResult.rows[0]?.total || '0', 10)
        const totalItems = parseInt(uniqueItemsResult.rows[0]?.total_items || '0', 10)
        const data = fromDbRowsToWearables(dataResult.rows)

        logger.debug(`Found ${data.length} wearables (${total} total, ${totalItems} unique items) for owner ${owner}`)
        return { data, total, totalItems }
      } finally {
        client.release()
      }
    } catch (error) {
      logger.error('Error fetching wearables by owner', {
        owner,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  /**
   * Gets minimal wearable data for profile validation - used by profiles endpoint
   * Returns only URN and token ID for efficient wearable ownership validation
   *
   * @param owner - Ethereum address of the wearable owner
   * @param first - Maximum number of wearables to return (default: 100)
   * @param skip - Number of wearables to skip (default: 0)
   * @returns Promise resolving to object with data array and total count
   */
  async function getOwnedWearablesUrnAndTokenId(
    owner: string,
    first = FIRST_DEFAULT,
    skip = SKIP_DEFAULT
  ): Promise<{ data: { urn: string; tokenId: string }[]; total: number }> {
    try {
      const client = await dappsDatabase.getPool().connect()

      try {
        const [dataQuery, countQuery] = [getOwnedWearablesUrnAndTokenIdQuery(owner, first, skip), getWearablesByOwnerCountQuery(owner)]

        const [dataResult, countResult] = await Promise.all([
          client.query<{ urn: string; token_id: string }>(dataQuery),
          client.query<{ total: string }>(countQuery)
        ])

        const total = parseInt(countResult.rows[0]?.total || '0', 10)
        const data = dataResult.rows.map(row => ({ urn: row.urn, tokenId: row.token_id }))

        logger.debug(`Found ${data.length} wearables (URN+tokenId) (${total} total) for owner ${owner}`)
        return { data, total }
      } finally {
        client.release()
      }
    } catch (error) {
      logger.error('Error fetching wearables URN and token ID by owner', {
        owner,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  /**
   * Gets complete emote data for a user - used by emotes endpoint
   * Returns full emote information including metadata, rarity, pricing, etc.
   *
   * @param owner - Ethereum address of the emote owner
   * @param first - Maximum number of emotes to return (default: 100)
   * @param skip - Number of emotes to skip (default: 0)
   * @returns Promise resolving to object with data array, total count, and total unique items
   */
  async function getEmotesByOwner(
    owner: string,
    first = FIRST_DEFAULT,
    skip = SKIP_DEFAULT
  ): Promise<{ data: ProfileEmote[]; total: number; totalItems: number }> {
    try {
      const client = await dappsDatabase.getPool().connect()

      try {
        const [dataQuery, countQuery, uniqueItemsQuery] = [
          getEmotesByOwnerQuery(owner, first, skip),
          getEmotesByOwnerCountQuery(owner),
          getEmotesByOwnerUniqueItemsCountQuery(owner)
        ]

        const [dataResult, countResult, uniqueItemsResult] = await Promise.all([
          client.query<DappsDbRow>(dataQuery),
          client.query<{ total: string }>(countQuery),
          client.query<{ total_items: string }>(uniqueItemsQuery)
        ])

        const total = parseInt(countResult.rows[0]?.total || '0', 10)
        const totalItems = parseInt(uniqueItemsResult.rows[0]?.total_items || '0', 10)
        const data = fromDbRowsToEmotes(dataResult.rows)

        logger.debug(`Found ${data.length} emotes (${total} total, ${totalItems} unique items) for owner ${owner}`)
        return { data, total, totalItems }
      } finally {
        client.release()
      }
    } catch (error) {
      logger.error('Error fetching emotes by owner', {
        owner,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  /**
   * Gets complete name/ENS data for a user - used by names endpoint
   * Returns full name information including contract details and pricing
   *
   * @param owner - Ethereum address of the name owner
   * @param first - Maximum number of names to return (default: 100)
   * @param skip - Number of names to skip (default: 0)
   * @returns Promise resolving to object with data array and total count
   */
  async function getNamesByOwner(owner: string, filters: UserAssetsFilters = {}): Promise<{ data: ProfileName[]; total: number }> {
    const { first = FIRST_DEFAULT, skip = SKIP_DEFAULT } = filters
    try {
      const client = await dappsDatabase.getPool().connect()

      try {
        const [dataQuery, countQuery] = [getNamesByOwnerQuery(owner, first, skip), getNamesByOwnerCountQuery(owner)]

        const [dataResult, countResult] = await Promise.all([
          client.query<DappsDbRow>(dataQuery),
          client.query<{ total: string }>(countQuery)
        ])

        const total = parseInt(countResult.rows[0]?.total || '0', 10)
        const data = fromDbRowsToNames(dataResult.rows)

        logger.debug(`Found ${data.length} names (${total} total) for owner ${owner}`)
        return { data, total }
      } finally {
        client.release()
      }
    } catch (error) {
      logger.error('Error fetching names by owner', {
        owner,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  /**
   * Gets minimal emote data for profile validation - used by profiles endpoint
   * Returns only URN and token ID for efficient emote ownership validation
   *
   * @param owner - Ethereum address of the emote owner
   * @param first - Maximum number of emotes to return (default: 100)
   * @param skip - Number of emotes to skip (default: 0)
   * @returns Promise resolving to object with data array and total count
   */
  async function getOwnedEmotesUrnAndTokenId(
    owner: string,
    first = FIRST_DEFAULT,
    skip = SKIP_DEFAULT
  ): Promise<{ data: { urn: string; tokenId: string }[]; total: number }> {
    try {
      const client = await dappsDatabase.getPool().connect()

      try {
        const [dataQuery, countQuery] = [getOwnedEmotesUrnAndTokenIdQuery(owner, first, skip), getEmotesByOwnerCountQuery(owner)]

        const [dataResult, countResult] = await Promise.all([
          client.query<{ urn: string; token_id: string }>(dataQuery),
          client.query<{ total: string }>(countQuery)
        ])

        const total = parseInt(countResult.rows[0]?.total || '0', 10)
        const data = dataResult.rows.map(row => ({ urn: row.urn, tokenId: row.token_id }))

        logger.debug(`Found ${data.length} emotes (URN+tokenId) (${total} total) for owner ${owner}`)
        return { data, total }
      } finally {
        client.release()
      }
    } catch (error) {
      logger.error('Error fetching emotes URN and token ID by owner', {
        owner,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  /**
   * Gets minimal name data for profile validation - used by profiles endpoint
   * Returns only the name/subdomain for efficient name ownership validation
   *
   * @param owner - Ethereum address of the name owner
   * @param first - Maximum number of names to return (default: 100)
   * @param skip - Number of names to skip (default: 0)
   * @returns Promise resolving to object with data array and total count
   */
  async function getOwnedNamesOnly(
    owner: string,
    first = FIRST_DEFAULT,
    skip = SKIP_DEFAULT
  ): Promise<{ data: { name: string }[]; total: number }> {
    try {
      const client = await dappsDatabase.getPool().connect()

      try {
        const [dataQuery, countQuery] = [getOwnedNamesOnlyQuery(owner, first, skip), getNamesByOwnerCountQuery(owner)]

        const [dataResult, countResult] = await Promise.all([
          client.query<{ name: string }>(dataQuery),
          client.query<{ total: string }>(countQuery)
        ])

        const total = parseInt(countResult.rows[0]?.total || '0', 10)
        const data = dataResult.rows

        logger.debug(`Found ${data.length} names (name only) (${total} total) for owner ${owner}`)
        return { data, total }
      } finally {
        client.release()
      }
    } catch (error) {
      logger.error('Error fetching names only by owner', {
        owner,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  /**
   * Gets grouped wearables data for a user - groups NFTs by URN
   * Returns wearables grouped by URN with individual data arrays, amounts, etc.
   *
   * @param owner - Ethereum address of the wearable owner
   * @param first - Maximum number of grouped wearables to return (default: 100)
   * @param skip - Number of grouped wearables to skip (default: 0)
   * @returns Promise resolving to object with data array and total count
   */
  async function getGroupedWearablesByOwner(
    owner: string,
    filters: UserAssetsFilters = {}
  ): Promise<{ data: GroupedWearable[]; total: number }> {
    const { first = FIRST_DEFAULT, skip = SKIP_DEFAULT, category, rarity, name, itemType, orderBy, direction } = filters
    try {
      const client = await dappsDatabase.getPool().connect()

      try {
        const itemFilters = { category, rarity, name, itemType }
        const sort = { orderBy, direction }

        const [dataQuery, countQuery] = [
          getGroupedWearablesByOwnerQuery(owner, first, skip, itemFilters, sort),
          getGroupedWearablesByOwnerCountQuery(owner, itemFilters)
        ]

        const [dataResult, countResult] = await Promise.all([client.query(dataQuery), client.query<{ total: string }>(countQuery)])

        const total = parseInt(countResult.rows[0]?.total || '0', 10)
        const data = fromDbRowsToGroupedWearables(dataResult.rows)

        logger.debug(`Found ${data.length} grouped wearables (${total} total unique) for owner ${owner}`, {
          category: category || '',
          rarity: rarity || '',
          name: name || '',
          itemType: itemType || ''
        })
        return { data, total }
      } finally {
        client.release()
      }
    } catch (error) {
      logger.error('Error fetching grouped wearables by owner', {
        owner,
        category: category || '',
        rarity: rarity || '',
        name: name || '',
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  /**
   * Gets grouped emotes data for a user - groups NFTs by URN
   * Returns emotes grouped by URN with individual data arrays, amounts, etc.
   *
   * @param owner - Ethereum address of the emote owner
   * @param first - Maximum number of grouped emotes to return (default: 100)
   * @param skip - Number of grouped emotes to skip (default: 0)
   * @returns Promise resolving to object with data array and total count
   */
  async function getGroupedEmotesByOwner(owner: string, filters: UserAssetsFilters = {}): Promise<{ data: GroupedEmote[]; total: number }> {
    const { first = FIRST_DEFAULT, skip = SKIP_DEFAULT, category, rarity, name, orderBy, direction } = filters
    try {
      const client = await dappsDatabase.getPool().connect()

      try {
        const itemFilters = { category, rarity, name }
        const sort = { orderBy, direction }

        const [dataQuery, countQuery] = [
          getGroupedEmotesByOwnerQuery(owner, first, skip, itemFilters, sort),
          getGroupedEmotesByOwnerCountQuery(owner, itemFilters)
        ]

        const [dataResult, countResult] = await Promise.all([client.query(dataQuery), client.query<{ total: string }>(countQuery)])

        const total = parseInt(countResult.rows[0]?.total || '0', 10)
        const data = fromDbRowsToGroupedEmotes(dataResult.rows)

        logger.debug(`Found ${data.length} grouped emotes (${total} total unique) for owner ${owner}`, {
          category: category || '',
          rarity: rarity || '',
          name: name || ''
        })
        return { data, total }
      } finally {
        client.release()
      }
    } catch (error) {
      logger.error('Error fetching grouped emotes by owner', {
        owner,
        category: category || '',
        rarity: rarity || '',
        name: name || '',
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  return {
    getWearablesByOwner,
    getOwnedWearablesUrnAndTokenId,
    getEmotesByOwner,
    getOwnedEmotesUrnAndTokenId,
    getNamesByOwner,
    getOwnedNamesOnly,
    getGroupedWearablesByOwner,
    getGroupedEmotesByOwner,
    ...dappsDatabase
  }
}
