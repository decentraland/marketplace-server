import { randomUUID } from 'crypto'
import { Client } from 'pg'
import { rebuildSearchTables } from '../../../src/logic/catalog/search-words-table'
import { BaseComponents } from '../../../src/types'

export type CreateSearchableWearableOptions = {
  itemId: string
  contractAddress: string
  /** The wearable's name — what the search indexes. */
  name: string
  /** The collection's name, indexed too (brand and collab names live there). */
  collectionName?: string
  category?: string
  isStoreMinterSet?: boolean
  available?: number
  collectionApproved?: boolean
  price?: string
  /** Squid epoch seconds. Two items given the same one tie on the newest sort, which is what a paging test needs. */
  createdAt?: number
  /** The item's creator. Defaults to the collection address, which is what the plain fixtures use. */
  creator?: string
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`

/**
 * A wearable item WITH a name: the plain item fixture inserts no metadata row, so the item has no name for
 * the search to index. Creates the collection (once), the wearable, its metadata row and the item.
 */
export async function createSearchableWearable(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  options: CreateSearchableWearableOptions
): Promise<void> {
  const { dappsDatabase } = dbComponent
  const {
    itemId,
    contractAddress,
    name,
    collectionName = 'Search Fixtures',
    category = 'hat',
    isStoreMinterSet = true,
    available = 1,
    collectionApproved = true,
    price = '100000000000000000000',
    createdAt = 1000000 + Number(itemId),
    creator = contractAddress
  } = options

  // Dash-joined like the squid's own ids, which is also the key the builder's tag view is joined on.
  const itemDbId = `${contractAddress}-${itemId}`
  const wearableId = `${itemDbId}_wearable`
  const metadataId = `${itemDbId}_metadata`

  await dappsDatabase.query(`
    INSERT INTO squid_marketplace."collection" (
      id, owner, creator, name, symbol, is_completed, is_approved, is_editable, minters, managers, urn, items_count,
      created_at, updated_at, reviewed_at, first_listed_at, search_is_store_minter, search_text, base_uri, chain_id, network
    ) VALUES (
      '${contractAddress}', '${contractAddress}', '${contractAddress}', ${quote(collectionName)}, 'SRCH', true, true, false,
      ARRAY['${contractAddress}'], ARRAY['${contractAddress}'], 'urn:decentraland:matic:collections-v2:${contractAddress}', 1,
      1000000, 1000000, 1000000, 1000000, true, ${quote(collectionName.toLowerCase())}, 'https://example.com/', 137, 'matic'
    ) ON CONFLICT (id) DO UPDATE SET name = ${quote(collectionName)}, search_text = ${quote(collectionName.toLowerCase())}
  `)

  await dappsDatabase.query(`
    INSERT INTO squid_marketplace."wearable" (
      id, representation_id, collection, name, description, category, rarity, body_shapes, network
    ) VALUES (
      '${wearableId}', NULL, '${contractAddress}', ${quote(name)}, 'A searchable wearable', '${category}', 'unique',
      ARRAY['BaseMale', 'BaseFemale'], 'matic'
    ) ON CONFLICT (id) DO UPDATE SET name = ${quote(name)}, category = '${category}'
  `)

  await dappsDatabase.query(`
    INSERT INTO squid_marketplace."metadata" (
      id, item_type, wearable_id, emote_id, network
    ) VALUES (
      '${metadataId}', 'wearable_v2', '${wearableId}', NULL, 'matic'
    ) ON CONFLICT (id) DO NOTHING
  `)

  await dappsDatabase.query(`
    INSERT INTO squid_marketplace."item" (
      id, blockchain_id, creator, item_type, total_supply, max_supply, rarity, creation_fee, available, price,
      beneficiary, content_hash, image, uri, minters, managers, raw_metadata, urn, created_at, updated_at, reviewed_at,
      first_listed_at, sales, volume, search_is_store_minter, search_is_marketplace_v3_minter, search_is_collection_approved,
      search_wearable_category, search_wearable_rarity, search_wearable_body_shapes, unique_collectors, unique_collectors_total,
      collection_id, metadata_id, network
    ) VALUES (
      '${itemDbId}', ${itemId}, ${quote(creator)}, 'wearable_v2', 1, 1, 'unique', 0, ${available}, ${price},
      '${contractAddress}', 'aContentHash',
      'https://peer.decentraland.org/lambdas/collections/contents/urn:decentraland:matic:collections-v2:${contractAddress}:${itemId}/thumbnail',
      'https://example.com/token/${itemId}',
      ARRAY['${contractAddress}'], ARRAY['${contractAddress}'], '{}', 'urn:decentraland:matic:collections-v2:${contractAddress}:${itemId}',
      ${createdAt}, 1000000, 1000000, 1000000, 0, 0,
      ${isStoreMinterSet ? 'true' : 'false'}, false, ${collectionApproved ? 'true' : 'false'},
      '${category}', 'unique', ARRAY['BaseMale', 'BaseFemale'], ARRAY[]::text[], 0,
      '${contractAddress}', '${metadataId}', 'matic'
    ) ON CONFLICT (id) DO UPDATE SET
      metadata_id = '${metadataId}',
      search_wearable_category = '${category}',
      search_is_store_minter = ${isStoreMinterSet ? 'true' : 'false'},
      available = ${available},
      search_is_collection_approved = ${collectionApproved ? 'true' : 'false'},
      price = ${price},
      created_at = ${createdAt},
      creator = ${quote(creator)}
  `)
}

export async function deleteSearchableWearable(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  itemId: string,
  contractAddress: string
): Promise<void> {
  const { dappsDatabase } = dbComponent
  const itemDbId = `${contractAddress}-${itemId}`
  await dappsDatabase.query(`DELETE FROM squid_marketplace."item" WHERE id = '${itemDbId}'`)
  await dappsDatabase.query(`DELETE FROM squid_marketplace."metadata" WHERE id = '${itemDbId}_metadata'`)
  await dappsDatabase.query(`DELETE FROM squid_marketplace."wearable" WHERE id = '${itemDbId}_wearable'`)
}

export async function deleteSearchableCollection(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  contractAddress: string
): Promise<void> {
  await dbComponent.dappsDatabase.query(`DELETE FROM squid_marketplace."collection" WHERE id = '${contractAddress}'`)
}

/** The search reads the pre-split word table, not the item names: fixtures are invisible until it is rebuilt. */
export async function rebuildSearchWords(dbComponent: Pick<BaseComponents, 'dappsDatabase'>): Promise<void> {
  const client = await dbComponent.dappsDatabase.getPool().connect()
  try {
    await rebuildSearchTables(client)
  } finally {
    client.release()
  }
}

export type CreateSearchTradeOptions = {
  contractAddress: string
  /** A collection item order (the Shop's primary listing) sells an item by its blockchain id... */
  itemId?: string
  /** ...and an NFT order sells one token — a name, a parcel, a wearable copy. */
  tokenId?: string
  owner?: string
  price?: string
}

/**
 * An open trade the UNIFIED feed lists as a NATIVE listing: the received asset is USD-pegged MANA (asset
 * type 2), which is the branch that also carries names, LAND and estates. The existing trade helper only
 * makes classic MANA (type 1) NFT orders, which land in the legacy branch that keeps item orders alone.
 * Refreshes mv_trades, which is what the feed reads.
 */
export async function createSearchNativeTrade(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  options: CreateSearchTradeOptions
): Promise<string> {
  const { dappsDatabase } = dbComponent
  const {
    contractAddress,
    itemId,
    tokenId,
    owner = '0x1234567890123456789012345678901234567890',
    price = '100000000000000000000'
  } = options
  const type = itemId != null ? 'public_item_order' : 'public_nft_order'
  const signature = `search_signature_${type}_${contractAddress}_${itemId ?? tokenId}_${Date.now()}`

  const client = await dappsDatabase.getPool().connect()
  try {
    const trade = await client.query(`
      INSERT INTO marketplace.trades (signature, hashed_signature, signer, type, network, chain_id, checks, expires_at, effective_since)
      VALUES (
        '${signature}', '${signature}', '${owner.toLowerCase()}', '${type}', 'matic', 80002,
        '{"uses": 1, "effective": ${Date.now()}, "expiration": ${
      Date.now() + 86400000
    }, "allowedRoot": "0x", "contractSignatureIndex": 0, "signerSignatureIndex": 0, "externalChecks": [], "salt": "0x"}',
        NOW() + INTERVAL '1 day', NOW()
      ) RETURNING id
    `)
    const tradeId = trade.rows[0].id as string

    const sent = await client.query(`
      INSERT INTO marketplace.trade_assets (trade_id, direction, asset_type, contract_address, beneficiary, extra)
      VALUES ('${tradeId}', 'sent', ${itemId != null ? 4 : 3}, '${contractAddress.toLowerCase()}', '${owner.toLowerCase()}', '0x')
      RETURNING id
    `)
    if (itemId != null) {
      await client.query(`INSERT INTO marketplace.trade_assets_item (asset_id, item_id) VALUES ('${sent.rows[0].id}', '${itemId}')`)
    } else {
      await client.query(`INSERT INTO marketplace.trade_assets_erc721 (asset_id, token_id) VALUES ('${sent.rows[0].id}', '${tokenId}')`)
    }

    const received = await client.query(`
      INSERT INTO marketplace.trade_assets (trade_id, direction, asset_type, contract_address, beneficiary, extra)
      VALUES ('${tradeId}', 'received', 2, '0x9d32aac179153a991e832550d9f96441ea27763a', '${owner.toLowerCase()}', '0x')
      RETURNING id
    `)
    await client.query(`INSERT INTO marketplace.trade_assets_erc20 (asset_id, amount) VALUES ('${received.rows[0].id}', '${price}')`)

    await client.query('REFRESH MATERIALIZED VIEW marketplace.mv_trades')
    return tradeId
  } finally {
    client.release()
  }
}

export async function deleteSearchTrade(dbComponent: Pick<BaseComponents, 'dappsDatabase'>, tradeId: string): Promise<void> {
  const { dappsDatabase } = dbComponent
  await dappsDatabase.query(
    `DELETE FROM marketplace.trade_assets_erc20 WHERE asset_id IN (SELECT id FROM marketplace.trade_assets WHERE trade_id = '${tradeId}')`
  )
  await dappsDatabase.query(
    `DELETE FROM marketplace.trade_assets_erc721 WHERE asset_id IN (SELECT id FROM marketplace.trade_assets WHERE trade_id = '${tradeId}')`
  )
  await dappsDatabase.query(
    `DELETE FROM marketplace.trade_assets_item WHERE asset_id IN (SELECT id FROM marketplace.trade_assets WHERE trade_id = '${tradeId}')`
  )
  await dappsDatabase.query(`DELETE FROM marketplace.trade_assets WHERE trade_id = '${tradeId}'`)
  await dappsDatabase.query(`DELETE FROM marketplace.trades WHERE id = '${tradeId}'`)
  await dappsDatabase.query('REFRESH MATERIALIZED VIEW marketplace.mv_trades')
}

/**
 * Tags live in the BUILDER's database and reach the marketplace through a materialized view over a
 * foreign table. The foreign table cannot be written (the builder's own NOT NULL columns are not part
 * of it), so the fixture goes straight to the builder database — through the connection the tests have
 * to it from the host, not the compose-internal name the foreign server uses — and then refreshes the view.
 */
export async function setBuilderTags(
  components: Pick<BaseComponents, 'dappsDatabase' | 'config'>,
  options: { contractAddress: string; itemId: string; tags: string[] }
): Promise<{ collectionId: string; itemId: string }> {
  const { config, dappsDatabase } = components
  const builder = new Client({ connectionString: await config.requireString('BUILDER_TEST_DB_CONNECTION_STRING') })
  const collectionId = randomUUID()
  const builderItemId = randomUUID()
  await builder.connect()
  try {
    await builder.query(
      `INSERT INTO collections (id, name, eth_address, contract_address, is_published, is_approved)
       VALUES ($1, 'Search Fixtures', '0x0000000000000000000000000000000000000001', $2, true, true)`,
      [collectionId, options.contractAddress]
    )
    await builder.query(
      `INSERT INTO items (id, name, eth_address, collection_id, blockchain_item_id, type, data, created_at, updated_at, thumbnail, contents)
       VALUES ($1, 'Search fixture', '0x0000000000000000000000000000000000000001', $2, $3, 'wearable', $4, NOW(), NOW(), '', '{}')`,
      [builderItemId, collectionId, options.itemId, JSON.stringify({ tags: options.tags })]
    )
  } finally {
    await builder.end()
  }
  await dappsDatabase.query('REFRESH MATERIALIZED VIEW marketplace.mv_builder_server_items')
  return { collectionId, itemId: builderItemId }
}

export async function clearBuilderTags(
  components: Pick<BaseComponents, 'dappsDatabase' | 'config'>,
  ids: { collectionId: string; itemId: string }
): Promise<void> {
  const { config, dappsDatabase } = components
  const builder = new Client({ connectionString: await config.requireString('BUILDER_TEST_DB_CONNECTION_STRING') })
  await builder.connect()
  try {
    await builder.query('DELETE FROM items WHERE id = $1', [ids.itemId])
    await builder.query('DELETE FROM collections WHERE id = $1', [ids.collectionId])
  } finally {
    await builder.end()
  }
  await dappsDatabase.query('REFRESH MATERIALIZED VIEW marketplace.mv_builder_server_items')
}

export type CreatorProfileFixture = {
  address: string
  /** The Catalyst profile name; null for a creator Catalyst has no profile for. */
  name: string | null
  names?: string[]
  items?: number
  collections?: number
  face?: string | null
}

/**
 * A creator as the profiles job would have written them, without going through Catalyst: the search
 * reads the table, and the table is what these specs are about. The words tables see the row after the
 * next rebuildSearchWords.
 */
export async function setCreatorProfile(dbComponent: Pick<BaseComponents, 'dappsDatabase'>, fixture: CreatorProfileFixture): Promise<void> {
  const { address, name, names = [], items = 0, collections = 0, face = null } = fixture
  const namesLiteral = names.length ? `ARRAY[${names.map(quote).join(', ')}]::text[]` : "'{}'::text[]"
  await dbComponent.dappsDatabase.query(`
    INSERT INTO marketplace.creator_profiles (address, name, has_claimed_name, face, names, items, collections)
    VALUES (${quote(address.toLowerCase())}, ${name === null ? 'NULL' : quote(name)}, ${name === null ? 'false' : 'true'},
            ${face === null ? 'NULL' : quote(face)}, ${namesLiteral}, ${items}, ${collections})
    ON CONFLICT (address) DO UPDATE SET
      name = EXCLUDED.name, has_claimed_name = EXCLUDED.has_claimed_name, face = EXCLUDED.face,
      names = EXCLUDED.names, items = EXCLUDED.items, collections = EXCLUDED.collections, updated_at = now()
  `)
}

export async function clearCreatorProfiles(dbComponent: Pick<BaseComponents, 'dappsDatabase'>): Promise<void> {
  await dbComponent.dappsDatabase.query('DELETE FROM marketplace.creator_profiles')
}

export type CreateSearchableNameOptions = {
  tokenId: string
  owner: string
  name: string
  /** Squid epoch seconds. The profiles refresh keeps a creator's OLDEST names, so the order matters. */
  createdAt?: number
}

const NAMES_CONTRACT = '0x2a187453064356c898cae034eaed119e1663acb8'

/** A NAME (an ENS nft plus its ens row) owned by an address, the way the squid records one. */
export async function createSearchableName(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  options: CreateSearchableNameOptions
): Promise<void> {
  const { tokenId, owner, name, createdAt = 1000000 + Number(tokenId) } = options
  const ensId = `${NAMES_CONTRACT}-${tokenId}-ens`
  const nftId = `${NAMES_CONTRACT}-${tokenId}`
  await dbComponent.dappsDatabase.query(`
    INSERT INTO squid_marketplace."ens" (id, token_id, subdomain, created_at, owner_id)
    VALUES ('${ensId}', ${tokenId}, ${quote(name)}, ${createdAt}, '${owner.toLowerCase()}-ETHEREUM')
    ON CONFLICT (id) DO UPDATE SET subdomain = ${quote(name)}, created_at = ${createdAt}
  `)
  await dbComponent.dappsDatabase.query(`
    INSERT INTO squid_marketplace."nft" (
      id, token_id, contract_address, category, name, created_at, updated_at, transferred_at, sales, volume,
      search_text, network, owner_address, owner_id, ens_id
    ) VALUES (
      '${nftId}', ${tokenId}, '${NAMES_CONTRACT}', 'ens', ${quote(name)}, ${createdAt}, ${createdAt}, ${createdAt}, 0, 0,
      ${quote(name.toLowerCase())}, 'ethereum', '${owner.toLowerCase()}', '${owner.toLowerCase()}-ETHEREUM', '${ensId}'
    ) ON CONFLICT (id) DO UPDATE SET name = ${quote(name)}, owner_address = '${owner.toLowerCase()}', created_at = ${createdAt}
  `)
}

export async function deleteSearchableName(dbComponent: Pick<BaseComponents, 'dappsDatabase'>, tokenId: string): Promise<void> {
  await dbComponent.dappsDatabase.query(`DELETE FROM squid_marketplace."nft" WHERE id = '${NAMES_CONTRACT}-${tokenId}'`)
  await dbComponent.dappsDatabase.query(`DELETE FROM squid_marketplace."ens" WHERE id = '${NAMES_CONTRACT}-${tokenId}-ens'`)
}
