import SQL, { SQLStatement } from 'sql-template-strings'

/**
 * Helper function to build ORDER BY clause for grouped items (wearables/emotes)
 * Matches lamb2 sorting logic: use maxTransferredAt for newest (DESC), minTransferredAt for oldest (ASC)
 *
 * @param orderBy - Sort field: 'rarity', 'name', or 'date' (default: 'rarity')
 * @param direction - Sort direction: 'ASC' or 'DESC' (default: 'DESC' for rarity/date, 'ASC' for name)
 * @returns SQLStatement with ORDER BY clause
 */
function buildOrderByClause(orderBy?: string, direction?: string): SQLStatement {
  const sort = (orderBy || 'rarity').toLowerCase()
  const dir = (direction || (sort === 'name' ? 'ASC' : 'DESC')).toUpperCase()

  if (sort === 'rarity') {
    return dir === 'ASC' ? SQL` ORDER BY rarity_order ASC, urn ASC` : SQL` ORDER BY rarity_order DESC, urn ASC`
  } else if (sort === 'name') {
    return dir === 'ASC' ? SQL` ORDER BY name ASC, urn ASC` : SQL` ORDER BY name DESC, urn ASC`
  } else if (sort === 'date') {
    return dir === 'ASC' ? SQL` ORDER BY min_transferred_at ASC, urn DESC` : SQL` ORDER BY max_transferred_at DESC, urn ASC`
  } else {
    // Default to rarity DESC if invalid sort specified
    return SQL` ORDER BY rarity_order DESC, urn ASC`
  }
}

/**
 * Gets full wearable data for a user - used by wearables endpoint
 * Returns complete wearable information including metadata, rarity, name, etc.
 *
 * @param owner - Ethereum address of the owner
 * @param first - Maximum number of wearables to return
 * @param skip - Number of wearables to skip
 * @returns SQL query for complete wearable data
 */
export function getWearablesByOwnerQuery(owner: string, first: number, skip: number): SQLStatement {
  return SQL`
    SELECT
      nft.id,
      nft.contract_address,
      nft.token_id::text as token_id,
      nft.network,
      nft.created_at,
      nft.updated_at,
      nft.urn,
      owner_address as owner,
      nft.image,
      nft.item_id,
      wearable.category,
      wearable.rarity,
      wearable.name,
      nft.item_type,
      wearable.description,
      transferred_at,
      item.price
    FROM squid_marketplace.nft nft
    LEFT JOIN squid_marketplace.metadata metadata on nft.metadata_id = metadata.id
    LEFT JOIN squid_marketplace.wearable wearable on metadata.wearable_id = wearable.id
    LEFT JOIN squid_marketplace.item item on nft.item_id = item.id
    WHERE owner_address = ${owner}
      AND nft.item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1')
    ORDER BY nft.created_at DESC
    LIMIT ${first}
    OFFSET ${skip}
  `
}

/**
 * Gets count of wearables for a user
 */
export function getWearablesByOwnerCountQuery(owner: string): SQLStatement {
  return SQL`
    SELECT COUNT(*) as total
    FROM squid_marketplace.nft nft
    WHERE owner_address = ${owner}
      AND nft.item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1')
  `
}

/**
 * Gets count of unique wearable items for a user (grouped by item_id)
 */
export function getWearablesByOwnerUniqueItemsCountQuery(owner: string): SQLStatement {
  return SQL`
    SELECT COUNT(DISTINCT nft.item_id) as total_items
    FROM squid_marketplace.nft nft
    WHERE owner_address = ${owner}
      AND nft.item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1')
  `
}

/**
 * Gets minimal wearable data for profile validation - used by profiles endpoint
 * Returns only URN and token ID for efficient profile wearable validation
 *
 * @param owner - Ethereum address of the owner
 * @param first - Maximum number of wearables to return
 * @param skip - Number of wearables to skip
 * @returns SQL query for URN and token ID only
 */
export function getOwnedWearablesUrnAndTokenIdQuery(owner: string, first: number, skip: number): SQLStatement {
  return SQL`
    SELECT
      nft.urn,
      nft.token_id::text as token_id
    FROM squid_marketplace.nft nft
    WHERE owner_address = ${owner}
      AND nft.item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1')
    ORDER BY nft.created_at DESC
    LIMIT ${first}
    OFFSET ${skip}
  `
}

/**
 * Gets full emote data for a user - used by emotes endpoint
 * Returns complete emote information including metadata, rarity, name, etc.
 *
 * @param owner - Ethereum address of the owner
 * @param first - Maximum number of emotes to return
 * @param skip - Number of emotes to skip
 * @returns SQL query for complete emote data
 */
export function getEmotesByOwnerQuery(owner: string, first: number, skip: number): SQLStatement {
  return SQL`
    SELECT
      nft.id,
      nft.contract_address,
      nft.token_id::text as token_id,
      nft.network,
      nft.created_at,
      nft.updated_at,
      nft.urn,
      owner_address as owner,
      nft.image,
      nft.item_id,
      emote.category,
      emote.rarity,
      emote.name,
      nft.item_type,
      emote.description,
      transferred_at,
      item.price
    FROM squid_marketplace.nft nft
    LEFT JOIN squid_marketplace.emote emote on nft.item_id = emote.id
    LEFT JOIN squid_marketplace.item item on nft.item_id = item.id
    WHERE owner_address = ${owner}
      AND nft.item_type = 'emote_v1'
    ORDER BY nft.created_at DESC
    LIMIT ${first}
    OFFSET ${skip}
  `
}

/**
 * Gets count of emotes for a user
 */
export function getEmotesByOwnerCountQuery(owner: string): SQLStatement {
  return SQL`
    SELECT COUNT(*) as total
    FROM squid_marketplace.nft nft
    WHERE owner_address = ${owner}
      AND nft.item_type = 'emote_v1'
  `
}

/**
 * Gets count of unique emote items for a user (grouped by item_id)
 */
export function getEmotesByOwnerUniqueItemsCountQuery(owner: string): SQLStatement {
  return SQL`
    SELECT COUNT(DISTINCT nft.item_id) as total_items
    FROM squid_marketplace.nft nft
    WHERE owner_address = ${owner}
      AND nft.item_type = 'emote_v1'
  `
}

/**
 * Gets minimal emote data for profile validation - used by profiles endpoint
 * Returns only URN and token ID for efficient profile emote validation
 *
 * @param owner - Ethereum address of the owner
 * @param first - Maximum number of emotes to return
 * @param skip - Number of emotes to skip
 * @returns SQL query for URN and token ID only
 */
export function getOwnedEmotesUrnAndTokenIdQuery(owner: string, first: number, skip: number): SQLStatement {
  return SQL`
    SELECT
      nft.urn,
      nft.token_id::text as token_id
    FROM squid_marketplace.nft nft
    WHERE owner_address = ${owner}
      AND nft.item_type = 'emote_v1'
    ORDER BY nft.created_at DESC
    LIMIT ${first}
    OFFSET ${skip}
  `
}

/**
 * Gets full name/ENS data for a user - used by names endpoint
 * Returns complete name information including contract details and pricing
 *
 * @param owner - Ethereum address of the owner (automatically lowercased)
 * @param first - Maximum number of names to return
 * @param skip - Number of names to skip
 * @returns SQL query for complete name data
 */
export function getNamesByOwnerQuery(owner: string, first: number, skip: number): SQLStatement {
  return SQL`
    SELECT
      nft.id,
      nft.contract_address,
      nft.token_id::text as token_id,
      nft.network,
      nft.created_at,
      nft.updated_at,
      nft.urn,
      owner_address as owner,
      nft.image,
      nft.category,
      ens.subdomain as name,
      transferred_at,
      orders.price
    FROM squid_marketplace.nft nft
    LEFT JOIN squid_marketplace.ens ens on ens.id = nft.ens_id
    LEFT JOIN squid_marketplace.order orders on orders.id = nft.active_order_id
    WHERE owner_address = ${owner.toLowerCase()}
      AND nft.category = 'ens'
    ORDER BY nft.id ASC
    LIMIT ${first}
    OFFSET ${skip}
  `
}

/**
 * Gets count of names for a user
 */
export function getNamesByOwnerCountQuery(owner: string): SQLStatement {
  return SQL`
    SELECT COUNT(*) as total
    FROM squid_marketplace.nft nft
    WHERE owner_address = ${owner.toLowerCase()}
      AND nft.category = 'ens'
  `
}

/**
 * Gets minimal name data for profile validation - used by profiles endpoint
 * Returns only the name/subdomain for efficient profile name validation
 *
 * @param owner - Ethereum address of the owner (automatically lowercased)
 * @param first - Maximum number of names to return
 * @param skip - Number of names to skip
 * @returns SQL query for name/subdomain only
 */
export function getOwnedNamesOnlyQuery(owner: string, first: number, skip: number): SQLStatement {
  return SQL`
    SELECT
      ens.subdomain as name
    FROM squid_marketplace.nft nft
    LEFT JOIN squid_marketplace.ens ens on ens.id = nft.ens_id
    WHERE owner_address = ${owner.toLowerCase()}
      AND nft.category = 'ens'
    ORDER BY nft.id ASC
    LIMIT ${first}
    OFFSET ${skip}
  `
}

/**
 * Gets grouped wearables data for a user - groups NFTs by URN
 * Returns wearables grouped by URN with individual data, amount, min/max transfer dates
 *
 * @param owner - Ethereum address of the owner
 * @param first - Maximum number of grouped wearables to return
 * @param skip - Number of grouped wearables to skip
 * @param category - Optional filter by category
 * @param rarity - Optional filter by rarity
 * @returns SQL query for grouped wearable data
 */
export function getGroupedWearablesByOwnerQuery(
  owner: string,
  first: number,
  skip: number,
  category?: string,
  rarity?: string,
  itemType?: string,
  orderBy?: string,
  direction?: string
): SQLStatement {
  const query = SQL`
    WITH grouped_wearables AS (
      SELECT
        nft.urn,
        wearable.category,
        wearable.rarity,
        wearable.name,
        COUNT(*) as amount,
        MIN(nft.transferred_at) as min_transferred_at,
        MAX(nft.transferred_at) as max_transferred_at,
        MIN(nft.created_at) as min_created_at,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'id', nft.urn || ':' || nft.token_id::text,
            'tokenId', nft.token_id::text,
            'transferredAt', COALESCE(nft.transferred_at, 0)::text,
            'price', COALESCE(item.price, 0)::text
          ) ORDER BY nft.created_at DESC
        ) as individual_data,
        CASE wearable.rarity
          WHEN 'unique' THEN 8
          WHEN 'mythic' THEN 7
          WHEN 'exotic' THEN 6
          WHEN 'legendary' THEN 5
          WHEN 'epic' THEN 4
          WHEN 'rare' THEN 3
          WHEN 'uncommon' THEN 2
          WHEN 'common' THEN 1
          ELSE 0
        END as rarity_order
      FROM squid_marketplace.nft nft
      LEFT JOIN squid_marketplace.metadata metadata on nft.metadata_id = metadata.id
      LEFT JOIN squid_marketplace.wearable wearable on metadata.wearable_id = wearable.id
      LEFT JOIN squid_marketplace.item item on nft.item_id = item.id
      WHERE owner_address = ${owner}
  `

  // Add optional item type filter
  if (itemType) {
    query.append(SQL` AND nft.item_type = ${itemType}`)
  } else {
    query.append(SQL` AND nft.item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1')`)
  }

  // Add optional category filter
  if (category) {
    query.append(SQL` AND wearable.category = ${category}`)
  }

  // Add optional rarity filter
  if (rarity) {
    query.append(SQL` AND wearable.rarity = ${rarity}`)
  }

  query.append(SQL`
      GROUP BY nft.urn, wearable.category, wearable.rarity, wearable.name
    )
    SELECT * FROM grouped_wearables
  `)

  // Add ORDER BY clause
  query.append(buildOrderByClause(orderBy, direction))

  query.append(SQL`
    LIMIT ${first}
    OFFSET ${skip}
  `)

  return query
}

/**
 * Gets count of grouped wearables for a user
 */
export function getGroupedWearablesByOwnerCountQuery(owner: string, category?: string, rarity?: string, itemType?: string): SQLStatement {
  const query = SQL`
    SELECT COUNT(DISTINCT nft.urn) as total
    FROM squid_marketplace.nft nft
    LEFT JOIN squid_marketplace.metadata metadata on nft.metadata_id = metadata.id
    LEFT JOIN squid_marketplace.wearable wearable on metadata.wearable_id = wearable.id
    WHERE owner_address = ${owner}
  `

  // Add optional category filter
  if (category) {
    query.append(SQL` AND wearable.category = ${category}`)
  }

  // Add optional rarity filter
  if (rarity) {
    query.append(SQL` AND wearable.rarity = ${rarity}`)
  }

  // Add optional item type filter
  if (itemType) {
    query.append(SQL` AND nft.item_type = ${itemType}`)
  } else {
    query.append(SQL` AND nft.item_type IN ('wearable_v1', 'wearable_v2', 'smart_wearable_v1')`)
  }

  return query
}

/**
 * Gets grouped emotes data for a user - groups NFTs by URN
 * Returns emotes grouped by URN with individual data, amount, min/max transfer dates
 *
 * @param owner - Ethereum address of the owner
 * @param first - Maximum number of grouped emotes to return
 * @param skip - Number of grouped emotes to skip
 * @param category - Optional filter by category
 * @param rarity - Optional filter by rarity
 * @returns SQL query for grouped emote data
 */
export function getGroupedEmotesByOwnerQuery(
  owner: string,
  first: number,
  skip: number,
  category?: string,
  rarity?: string,
  orderBy?: string,
  direction?: string
): SQLStatement {
  const query = SQL`
    WITH grouped_emotes AS (
      SELECT
        nft.urn,
        emote.category,
        emote.rarity,
        emote.name,
        COUNT(*) as amount,
        MIN(nft.transferred_at) as min_transferred_at,
        MAX(nft.transferred_at) as max_transferred_at,
        MIN(nft.created_at) as min_created_at,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'id', nft.urn || ':' || nft.token_id::text,
            'tokenId', nft.token_id::text,
            'transferredAt', COALESCE(nft.transferred_at, 0)::text,
            'price', COALESCE(item.price, 0)::text
          ) ORDER BY nft.created_at DESC
        ) as individual_data,
        CASE emote.rarity
          WHEN 'unique' THEN 8
          WHEN 'mythic' THEN 7
          WHEN 'exotic' THEN 6
          WHEN 'legendary' THEN 5
          WHEN 'epic' THEN 4
          WHEN 'rare' THEN 3
          WHEN 'uncommon' THEN 2
          WHEN 'common' THEN 1
          ELSE 0
        END as rarity_order
      FROM squid_marketplace.nft nft
      LEFT JOIN squid_marketplace.emote emote on nft.item_id = emote.id
      LEFT JOIN squid_marketplace.item item on nft.item_id = item.id
      WHERE owner_address = ${owner}
        AND nft.item_type = 'emote_v1'
  `

  // Add optional category filter
  if (category) {
    query.append(SQL` AND emote.category = ${category}`)
  }

  // Add optional rarity filter
  if (rarity) {
    query.append(SQL` AND emote.rarity = ${rarity}`)
  }

  query.append(SQL`
      GROUP BY nft.urn, emote.category, emote.rarity, emote.name
    )
    SELECT * FROM grouped_emotes
  `)

  // Add ORDER BY clause
  query.append(buildOrderByClause(orderBy, direction))

  query.append(SQL`
    LIMIT ${first}
    OFFSET ${skip}
  `)

  return query
}

/**
 * Gets count of grouped emotes for a user
 */
export function getGroupedEmotesByOwnerCountQuery(owner: string, category?: string, rarity?: string): SQLStatement {
  const query = SQL`
    SELECT COUNT(DISTINCT nft.urn) as total
    FROM squid_marketplace.nft nft
    LEFT JOIN squid_marketplace.emote emote on nft.item_id = emote.id
    WHERE owner_address = ${owner}
      AND nft.item_type = 'emote_v1'
  `

  // Add optional category filter
  if (category) {
    query.append(SQL` AND emote.category = ${category}`)
  }

  // Add optional rarity filter
  if (rarity) {
    query.append(SQL` AND emote.rarity = ${rarity}`)
  }

  return query
}
