import { Network, NFTCategory, Rarity, WearableCategory } from '@dcl/schemas'
import { BaseComponents } from '../../../src/types'

export type CreateDBItemOptions = {
  itemId: string
  contractAddress: string
  isStoreMinterSet?: boolean
  available?: number
  collectionApproved?: boolean
  price?: string
}

export type CreateDBOrderOptions = {
  itemId: string
  contractAddress: string
  price: string
  expiresAt?: number
  status?: string
  orderId?: string
}

export type CreateDBNFTOptions = {
  tokenId: string
  contractAddress: string
  owner?: string
  category?: string
  isOnSale?: boolean
  isOnRent?: boolean
  price?: string
  network?: string
  name?: string
  image?: string
  wearableCategory?: string
  rarity?: string
  adjacentToRoad?: boolean
  distanceToPlaza?: number
  estateSize?: number
  rentalStatus?: string
}

export async function createSquidDBItem(dbComponent: Pick<BaseComponents, 'dappsDatabase'>, options: CreateDBItemOptions): Promise<void> {
  const { dappsDatabase } = dbComponent
  const {
    itemId,
    contractAddress,
    isStoreMinterSet = false,
    available = 1,
    collectionApproved = true,
    price = '100000000000000000000'
  } = options
  const client = await dappsDatabase.getPool().connect()

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
        search_is_collection_approved,
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
        ${available},
        ${price},
        '${contractAddress}',
        'aContentHash',
        NULL,
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
        ${collectionApproved ? 'true' : 'false'},
        ARRAY[]::text[],
        0,
        '${contractAddress}',
        'matic'
      ) ON CONFLICT (id) DO UPDATE SET
        search_is_store_minter = ${isStoreMinterSet ? 'true' : 'false'},
        available = ${available},
        search_is_collection_approved = ${collectionApproved ? 'true' : 'false'},
        price = ${price}
    `)
  } finally {
    await client.release()
  }
}

export async function createSquidDBOrder(dbComponent: Pick<BaseComponents, 'dappsDatabase'>, options: CreateDBOrderOptions): Promise<void> {
  const { dappsDatabase } = dbComponent
  const {
    itemId,
    contractAddress,
    price,
    expiresAt = Math.floor(Date.now() / 1000) + 86400,
    status = 'open',
    orderId = `order_${itemId}_${Date.now()}`
  } = options

  const client = await dappsDatabase.getPool().connect()

  try {
    await client.query(`
      INSERT INTO squid_marketplace."order" (
        id,
        marketplace_address,
        category,
        nft_address,
        token_id,
        tx_hash,
        owner,
        buyer,
        price,
        status,
        block_number,
        expires_at,
        created_at,
        updated_at,
        network,
        item_id,
        expires_at_normalized
      ) VALUES (
        '${orderId}',
        '0x8de9c5a032463c561423387a9648c5c7bcc5bc90',
        'wearable',
        '${contractAddress}',
        ${itemId},
        '0x1234567890abcdef',
        '0x1234567890123456789012345678901234567890',
        NULL,
        ${price},
        '${status}',
        1000000,
        ${expiresAt},
        ${Math.floor(Date.now() / 1000)},
        ${Math.floor(Date.now() / 1000)},
        'matic',
        '${contractAddress}_${itemId}',
        NOW() + INTERVAL '1 day'
      ) ON CONFLICT (id) DO UPDATE SET
        status = '${status}',
        price = ${price}
    `)
  } finally {
    await client.release()
  }
}

export async function createItemOnlyMintingOld(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  contractAddress: string,
  itemId: string,
  price = '100000000000000000000'
): Promise<void> {
  await createSquidDBItem(dbComponent, {
    itemId,
    contractAddress,
    isStoreMinterSet: true,
    available: 1,
    price,
    collectionApproved: true
  })
}

export async function createItemOnlyListingOld(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  contractAddress: string,
  itemId: string,
  price = '50000000000000000000'
): Promise<void> {
  await createSquidDBItem(dbComponent, {
    itemId,
    contractAddress,
    isStoreMinterSet: false,
    available: 0,
    collectionApproved: true
  })

  await createSquidDBOrder(dbComponent, {
    itemId,
    contractAddress,
    price
  })
}

export async function createItemNotForSale(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  contractAddress: string,
  itemId: string
): Promise<void> {
  await createSquidDBItem(dbComponent, {
    itemId,
    contractAddress,
    isStoreMinterSet: false,
    available: 0,
    collectionApproved: true
  })
}

export async function createItemMintingAndListing(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  contractAddress: string,
  itemId: string,
  mintPrice = '100000000000000000000',
  listPrice = '50000000000000000000'
): Promise<void> {
  await createSquidDBItem(dbComponent, {
    itemId,
    contractAddress,
    isStoreMinterSet: true,
    available: 1,
    price: mintPrice,
    collectionApproved: true
  })

  await createSquidDBOrder(dbComponent, {
    itemId,
    contractAddress,
    price: listPrice
  })
}

export async function createItemNotApproved(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  contractAddress: string,
  itemId: string
): Promise<void> {
  await createSquidDBItem(dbComponent, {
    itemId,
    contractAddress,
    isStoreMinterSet: true,
    available: 1,
    collectionApproved: false
  })
}

export async function deleteSquidDBItem(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  itemId: string,
  contractAddress: string
): Promise<void> {
  const { dappsDatabase } = dbComponent
  const client = await dappsDatabase.getPool().connect()
  try {
    await client.query(`DELETE FROM squid_marketplace."order" WHERE item_id = '${contractAddress}_${itemId}'`)
    await client.query(`DELETE FROM squid_marketplace."item" WHERE id = '${contractAddress}_${itemId}'`)
  } finally {
    await client.release()
  }
}

export async function createSquidDBNFT(dbComponent: Pick<BaseComponents, 'dappsDatabase'>, options: CreateDBNFTOptions): Promise<void> {
  const { dappsDatabase } = dbComponent
  const {
    tokenId,
    contractAddress,
    owner = '0x1234567890123456789012345678901234567890',
    category = NFTCategory.WEARABLE,
    isOnSale = false,
    price = '100000000000000000000',
    network = Network.MATIC,
    name = 'Test NFT',
    image = 'https://example.com/image.png',
    wearableCategory = WearableCategory.HAT,
    rarity = Rarity.COMMON,
    adjacentToRoad = false,
    distanceToPlaza = 100,
    estateSize = 1
  } = options

  const client = await dappsDatabase.getPool().connect()

  try {
    // Insert account if it doesn't exist
    const accountId = `${owner.toLowerCase()}-${network.toUpperCase()}`
    await client.query(`
      INSERT INTO squid_marketplace."account" (
        id,
        address,
        sales,
        purchases,
        spent,
        earned,
        royalties,
        primary_sales,
        primary_sales_earned,
        unique_and_mythic_items,
        unique_and_mythic_items_total,
        collections,
        creators_supported,
        creators_supported_total,
        unique_collectors,
        unique_collectors_total,
        network
      ) VALUES (
        '${accountId}',
        '${owner.toLowerCase()}',
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        ARRAY[]::text[],
        0,
        0,
        ARRAY[]::text[],
        0,
        ARRAY[]::text[],
        0,
        '${network.toLowerCase()}'
      ) ON CONFLICT (id) DO NOTHING
    `)

    const id = `${
      category === NFTCategory.PARCEL || category === NFTCategory.ESTATE ? (category === NFTCategory.ESTATE ? 'estate-' : 'parcel-') : ''
    }${contractAddress}-${tokenId}`

    // Insert NFT
    await client.query(`
      INSERT INTO squid_marketplace."nft" (
        id,
        token_id,
        contract_address,
        category,
        token_uri,
        name,
        image,
        created_at,
        updated_at,
        sold_at,
        transferred_at,
        sales,
        volume,
        search_order_status,
        search_order_price,
        search_order_expires_at,
        search_order_created_at,
        search_is_land,
        search_text,
        search_parcel_is_in_bounds,
        search_parcel_x,
        search_parcel_y,
        search_distance_to_plaza,
        search_adjacent_to_road,
        search_estate_size,
        search_is_wearable_head,
        search_is_wearable_accessory,
        search_wearable_rarity,
        search_wearable_category,
        search_wearable_body_shapes,
        item_blockchain_id,
        issued_id,
        item_type,
        urn,
        search_item_type,
        search_emote_category,
        search_emote_loop,
        search_emote_rarity,
        search_emote_body_shapes,
        network,
        owner_address,
        owner_id
      ) VALUES (
        '${id}',
        ${tokenId},
        '${contractAddress}',
        '${category}',
        'https://example.com/token/${tokenId}',
        '${name}',
        '${image}',
        ${Math.floor(Date.now() / 1000)},
        ${Math.floor(Date.now() / 1000)},
        ${isOnSale ? Math.floor(Date.now() / 1000) : 'NULL'},
        ${Math.floor(Date.now() / 1000)},
        0,
        0,
        ${isOnSale ? "'open'" : 'NULL'},
        ${isOnSale ? price : 'NULL'},
        ${isOnSale ? Math.floor(Date.now() / 1000) + 86400 : 'NULL'},
        ${isOnSale ? Math.floor(Date.now() / 1000) : 'NULL'},
        ${category === 'parcel' || category === 'estate' ? 'true' : 'false'},
        '${name.toLowerCase()}',
        ${category === 'parcel' ? 'true' : 'false'},
        ${category === 'parcel' ? Math.floor(Math.random() * 100) : 'NULL'},
        ${category === 'parcel' ? Math.floor(Math.random() * 100) : 'NULL'},
        ${distanceToPlaza},
        ${adjacentToRoad ? 'true' : 'false'},
        ${category === 'estate' ? estateSize : 1},
        ${category === 'wearable' && wearableCategory === 'hat' ? 'true' : 'false'},
        ${category === 'wearable' && wearableCategory !== 'hat' ? 'true' : 'false'},
        '${rarity}',
        '${wearableCategory}',
        ARRAY['male', 'female'],
        ${tokenId},
        ${tokenId},
        'wearable_v1',
        'urn:decentraland:${contractAddress}:${tokenId}',
        'wearable',
        ${category === 'emote' ? "'dance'" : 'NULL'},
        ${category === 'emote' ? 'false' : 'NULL'},
        '${rarity}',
        ARRAY['male', 'female'],
        '${network}',
        '${owner.toLowerCase()}',
        '${accountId}'
      ) ON CONFLICT (id) DO UPDATE SET
        search_order_status = ${isOnSale ? "'open'" : 'NULL'},
        search_order_price = ${isOnSale ? price : 'NULL'},
        owner_address = '${owner.toLowerCase()}',
        owner_id = '${accountId}'
    `)

    // Create order if NFT is on sale
    if (isOnSale) {
      await client.query(`
        INSERT INTO squid_marketplace."order" (
          id,
          marketplace_address,
          category,
          nft_address,
          token_id,
          tx_hash,
          owner,
          buyer,
          price,
          status,
          block_number,
          expires_at,
          created_at,
          updated_at,
          nft_id,
          network,
          expires_at_normalized
        ) VALUES (
          'order_${tokenId}_${Date.now()}',
          '0x8de9c5a032463c561423387a9648c5c7bcc5bc90',
          '${category}',
          '${contractAddress}',
          ${tokenId},
          '0x1234567890abcdef',
          '${owner}',
          NULL,
          ${price},
          'open',
          1000000,
          ${Math.floor(Date.now() / 1000) + 86400},
          ${Math.floor(Date.now() / 1000)},
          ${Math.floor(Date.now() / 1000)},
          '${contractAddress}-${tokenId}',
          '${network}',
          NOW() + INTERVAL '1 day'
        ) ON CONFLICT (id) DO NOTHING
      `)
    }
  } finally {
    await client.release()
  }
}

export async function deleteSquidDBNFT(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  tokenId: string,
  contractAddress: string
): Promise<void> {
  const { dappsDatabase } = dbComponent
  const client = await dappsDatabase.getPool().connect()
  try {
    await client.query(`DELETE FROM squid_marketplace."order" WHERE nft_id = '${contractAddress}-${tokenId}'`)
    await client.query(`DELETE FROM squid_marketplace."nft" WHERE id = '${contractAddress}-${tokenId}'`)
  } finally {
    await client.release()
  }
}

export async function createNFTOnSale(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  contractAddress: string,
  tokenId: string,
  price = '100000000000000000000',
  owner = '0x1234567890123456789012345678901234567890'
): Promise<void> {
  await createSquidDBNFT(dbComponent, {
    tokenId,
    contractAddress,
    owner,
    isOnSale: true,
    price
  })
}

export async function createNFTNotForSale(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  contractAddress: string,
  tokenId: string,
  owner = '0x1234567890123456789012345678901234567890'
): Promise<void> {
  await createSquidDBNFT(dbComponent, {
    tokenId,
    contractAddress,
    owner,
    isOnSale: false
  })
}

export async function createWearableNFT(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  contractAddress: string,
  tokenId: string,
  options: Partial<CreateDBNFTOptions> = {}
): Promise<void> {
  await createSquidDBNFT(dbComponent, {
    tokenId,
    contractAddress,
    category: NFTCategory.WEARABLE,
    wearableCategory: WearableCategory.HAT,
    rarity: Rarity.COMMON,
    ...options
  })
}

export async function createParcelNFT(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  contractAddress: string,
  tokenId: string,
  options: Partial<CreateDBNFTOptions> = {}
): Promise<void> {
  await createSquidDBNFT(dbComponent, {
    tokenId,
    contractAddress,
    category: NFTCategory.PARCEL,
    adjacentToRoad: false,
    distanceToPlaza: 100,
    ...options
  })
}

export async function createEstateNFT(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  contractAddress: string,
  tokenId: string,
  options: Partial<CreateDBNFTOptions> = {}
): Promise<void> {
  await createSquidDBNFT(dbComponent, {
    tokenId,
    contractAddress,
    category: NFTCategory.ESTATE,
    estateSize: 5,
    adjacentToRoad: false,
    distanceToPlaza: 50,
    ...options
  })
}

export async function createSquidDBTrade(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  options: {
    tokenId: string
    contractAddress: string
    owner?: string
    price?: string
    signature?: string
    type?: string
  }
): Promise<string> {
  const { dappsDatabase } = dbComponent
  const {
    tokenId,
    contractAddress,
    owner = '0x1234567890123456789012345678901234567890',
    price = '100000000000000000000',
    signature = `signature_${tokenId}_${Date.now()}`,
    type = 'public_nft_order'
  } = options

  const client = await dappsDatabase.getPool().connect()

  try {
    // Generate a proper UUID for trade
    const tradeResult = await client.query(`
      INSERT INTO marketplace.trades (
        signature,
        hashed_signature,
        signer,
        type,
        network,
        chain_id,
        checks,
        expires_at,
        effective_since
      ) VALUES (
        '${signature}',
        '${signature}',
        '${owner.toLowerCase()}',
        '${type}',
        'matic',
        80002,
        '{"uses": 1, "effective": ${Date.now()}, "expiration": ${
      Date.now() + 86400000
    }, "allowedRoot": "0x", "contractSignatureIndex": 0, "signerSignatureIndex": 0, "externalChecks": [], "salt": "0x"}',
        NOW() + INTERVAL '1 day',
        NOW()
      ) RETURNING id
    `)

    const tradeId = tradeResult.rows[0].id

    // Insert the sent asset (NFT being sold)
    const sentAssetResult = await client.query(`
      INSERT INTO marketplace.trade_assets (
        trade_id,
        direction,
        asset_type,
        contract_address,
        beneficiary,
        extra
      ) VALUES (
        '${tradeId}',
        'sent',
        3,
        '${contractAddress.toLowerCase()}',
        '${owner.toLowerCase()}',
        '0x'
      ) RETURNING id
    `)

    // Insert the ERC721 details for the sent asset
    await client.query(`
      INSERT INTO marketplace.trade_assets_erc721 (
        asset_id,
        token_id
      ) VALUES (
        '${sentAssetResult.rows[0].id}',
        '${tokenId}'
      )
    `)

    // Insert the received asset (MANA payment)
    const receivedAssetResult = await client.query(`
      INSERT INTO marketplace.trade_assets (
        trade_id,
        direction,
        asset_type,
        contract_address,
        beneficiary,
        extra
      ) VALUES (
        '${tradeId}',
        'received',
        1,
        '0x9d32aac179153a991e832550d9f96441ea27763a',
        '${owner.toLowerCase()}',
        '0x'
      ) RETURNING id
    `)

    // Insert the ERC20 details for the received asset
    await client.query(`
      INSERT INTO marketplace.trade_assets_erc20 (
        asset_id,
        amount
      ) VALUES (
        '${receivedAssetResult.rows[0].id}',
        '${price}'
      )
    `)

    return tradeId
  } finally {
    await client.release()
  }
}

export async function deleteSquidDBTrade(dbComponent: Pick<BaseComponents, 'dappsDatabase'>, tradeId: string): Promise<void> {
  const { dappsDatabase } = dbComponent
  const client = await dappsDatabase.getPool().connect()

  try {
    // Delete from trade_assets_erc721
    await client.query(`
      DELETE FROM marketplace.trade_assets_erc721 
      WHERE asset_id IN (
        SELECT id FROM marketplace.trade_assets WHERE trade_id = '${tradeId}'
      )
    `)

    // Delete from trade_assets_erc20
    await client.query(`
      DELETE FROM marketplace.trade_assets_erc20 
      WHERE asset_id IN (
        SELECT id FROM marketplace.trade_assets WHERE trade_id = '${tradeId}'
      )
    `)

    // Delete from trade_assets
    await client.query(`DELETE FROM marketplace.trade_assets WHERE trade_id = '${tradeId}'`)

    // Delete from trades
    await client.query(`DELETE FROM marketplace.trades WHERE id = '${tradeId}'`)
  } finally {
    await client.release()
  }
}

export async function createNFTOnSaleTrade(
  dbComponent: Pick<BaseComponents, 'dappsDatabase'>,
  contractAddress: string,
  tokenId: string,
  price = '100000000000000000000',
  owner = '0x1234567890123456789012345678901234567890'
): Promise<string> {
  const tradeId = await createSquidDBTrade(dbComponent, {
    tokenId,
    contractAddress,
    owner,
    price
  })

  // Refresh the materialized view to make the trade visible to queries
  await refreshTradesMaterializedView(dbComponent)

  return tradeId
}

export async function refreshTradesMaterializedView(dbComponent: Pick<BaseComponents, 'dappsDatabase'>): Promise<void> {
  const { dappsDatabase } = dbComponent
  const client = await dappsDatabase.getPool().connect()

  try {
    await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY marketplace.mv_trades')
  } catch (error) {
    // If CONCURRENTLY fails, try without it
    await client.query('REFRESH MATERIALIZED VIEW marketplace.mv_trades')
  } finally {
    await client.release()
  }
}
