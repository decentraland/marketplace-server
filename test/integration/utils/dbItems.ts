import { BaseComponents } from '../../../src/types'

export type CreateDBItemOptions = {
  itemId: string
  contractAddress: string
  isStoreMinterSet?: boolean
}

export async function createSquidDBItem(dbComponent: Pick<BaseComponents, 'dappsDatabase'>, options: CreateDBItemOptions): Promise<void> {
  const { dappsDatabase } = dbComponent
  const { itemId, contractAddress, isStoreMinterSet } = options
  const client = await dappsDatabase.getPool().connect()
  // collection id
  // metadata id

  try {
    await client.query(`
      INSERT INTO squid_marketplace."item" (
        id,
        blockchain_id,
        creator,
        item_type,
        total_supply,
        max_supply,
        rarity,
        creation_fee,
        available,
        price,
        beneficiary,
        content_hash,
        image,
        uri,
        minters,
        managers,
        raw_metadata,
        urn,
        created_at,
        updated_at,
        reviewed_at,
        first_listed_at,
        sales,
        volume,
        search_is_store_minter,
        unique_collectors,
        unique_collectors_total,
        collection_id,
        network
      ) VALUES (
        '${contractAddress}_${itemId}',
        ${itemId},
        '${contractAddress}',
        'wearable_v1',
        1,
        1,
        'unique',
        0,
        1,
        100000000000000000000,
        '${contractAddress}',
        'aContentHash',
        'https://example.com/token/1/image.png',
        'https://example.com/token/1',
        ARRAY['${contractAddress}'],
        ARRAY['${contractAddress}'],
        '{}',
        'urn:decentraland:${contractAddress}:${itemId}',
        1000000,
        1000000,
        1000000,
        1000000,
        0,
        0,
        ${isStoreMinterSet ? 'true' : 'false'},
        ARRAY[]::text[],
        0,
        '${contractAddress}',
        'matic'
      )
    `)
  } finally {
    await client.release()
  }
}

export async function deleteSquidDBItem(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  itemId: string,
  contractAddress: string
): Promise<void> {
  const { dappsDatabase } = dbComponent
  const client = await dappsDatabase.getPool().connect()
  try {
    await client.query(`DELETE FROM squid_marketplace."item" WHERE id = '${contractAddress}_${itemId}'`)
  } finally {
    await client.release()
  }
}
