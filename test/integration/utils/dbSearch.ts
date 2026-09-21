import { rebuildItemSearchWords } from '../../../src/logic/catalog/search-words-table'
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
    price = '100000000000000000000'
  } = options

  const itemDbId = `${contractAddress}_${itemId}`
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
      '${itemDbId}', ${itemId}, '${contractAddress}', 'wearable_v2', 1, 1, 'unique', 0, ${available}, ${price},
      '${contractAddress}', 'aContentHash',
      'https://peer.decentraland.org/lambdas/collections/contents/urn:decentraland:matic:collections-v2:${contractAddress}:${itemId}/thumbnail',
      'https://example.com/token/${itemId}',
      ARRAY['${contractAddress}'], ARRAY['${contractAddress}'], '{}', 'urn:decentraland:matic:collections-v2:${contractAddress}:${itemId}',
      ${1000000 + Number(itemId)}, 1000000, 1000000, 1000000, 0, 0,
      ${isStoreMinterSet ? 'true' : 'false'}, false, ${collectionApproved ? 'true' : 'false'},
      '${category}', 'unique', ARRAY['BaseMale', 'BaseFemale'], ARRAY[]::text[], 0,
      '${contractAddress}', '${metadataId}', 'matic'
    ) ON CONFLICT (id) DO UPDATE SET
      metadata_id = '${metadataId}',
      search_wearable_category = '${category}',
      search_is_store_minter = ${isStoreMinterSet ? 'true' : 'false'},
      available = ${available},
      search_is_collection_approved = ${collectionApproved ? 'true' : 'false'},
      price = ${price}
  `)
}

export async function deleteSearchableWearable(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  itemId: string,
  contractAddress: string
): Promise<void> {
  const { dappsDatabase } = dbComponent
  const itemDbId = `${contractAddress}_${itemId}`
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
    await rebuildItemSearchWords(client)
  } finally {
    client.release()
  }
}
