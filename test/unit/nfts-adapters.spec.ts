import { BodyShape, EmoteCategory, ListingStatus, Network, NFT, NFTCategory, Rarity, WearableCategory } from '@dcl/schemas'
import { fromDBNFTToNFT, fromNFTsAndOrdersToNFTsResult } from '../../src/adapters/nfts'
import { fromDBOrderToOrder } from '../../src/adapters/orders'
import { getNetwork, getNetworkChainId } from '../../src/logic/chainIds'
import { capitalize } from '../../src/logic/strings'
import { DBNFT, ItemType } from '../../src/ports/nfts/types'
import { DBOrder } from '../../src/ports/orders/types'
import { SquidNetwork } from '../../src/types'

describe('fromDBNFTToNFT', () => {
  it('should return the correct NFT object for a wearable DBNFT', () => {
    const dbNFT: DBNFT = {
      id: '1',
      category: NFTCategory.WEARABLE,
      network: Network.ETHEREUM,
      contract_address: '0x123abc',
      created_at: 1634567890,
      image: 'https://example.com/image.png',
      owner: '0x456def',
      token_id: '123',
      name: 'Wearable NFT',
      body_shapes: [BodyShape.FEMALE, BodyShape.MALE],
      wearableCategory: WearableCategory.HAT,
      description: 'A cool wearable NFT',
      rarity: Rarity.COMMON,
      item_type: ItemType.SMART_WEARABLE_V1,
      updated_at: 1634567890,
      count: 1,
      sold_at: 0,
      url: 'https:test.com',
      urn: '123:2312',
      issued_id: '123',
      item_id: '123'
    }

    const expectedNFT: NFT = {
      activeOrderId: null,
      category: NFTCategory.WEARABLE,
      chainId: getNetworkChainId(dbNFT.network),
      contractAddress: dbNFT.contract_address,
      createdAt: dbNFT.created_at,
      data: {
        wearable: {
          bodyShapes: dbNFT.body_shapes,
          category: dbNFT.wearableCategory as WearableCategory,
          description: dbNFT.description || '',
          rarity: dbNFT.rarity,
          isSmart: dbNFT.item_type === ItemType.SMART_WEARABLE_V1
        }
      },
      id: dbNFT.id,
      image: dbNFT.image,
      issuedId: dbNFT.issued_id,
      itemId: dbNFT.item_id,
      name: dbNFT.name || capitalize(dbNFT.category),
      network: getNetwork(dbNFT.network),
      openRentalId: null,
      owner: dbNFT.owner.toLowerCase(),
      tokenId: dbNFT.token_id,
      soldAt: 0,
      updatedAt: dbNFT.updated_at,
      url: `/contracts/${dbNFT.contract_address}/tokens/${dbNFT.token_id}`
    }

    const result = fromDBNFTToNFT(dbNFT)

    expect(result).toEqual(expectedNFT)
  })

  it('should return the correct NFT object for a parcel DBNFT', () => {
    const dbNFT: DBNFT = {
      id: '2',
      category: NFTCategory.PARCEL,
      network: Network.ETHEREUM,
      contract_address: '0x456def',
      created_at: 1634567890,
      image: 'https://example.com/image.png',
      owner: '0x789ghi',
      token_id: '456',
      x: '10',
      y: '20',
      description: 'A cool parcel NFT',
      parcel_estate_id: '123',
      parcel_estate_name: 'Estate 1',
      parcel_estate_token_id: '789',
      updated_at: 1634567890,
      body_shapes: [],
      item_type: ItemType.EMOTE_V1,
      rarity: Rarity.COMMON,
      count: 1,
      sold_at: 0,
      name: 'Test name',
      url: 'https:test.com',
      urn: '123:2312',
      issued_id: '123',
      item_id: '123'
    }

    const expectedNFT: NFT = {
      activeOrderId: null,
      category: NFTCategory.PARCEL,
      chainId: getNetworkChainId(dbNFT.network),
      contractAddress: dbNFT.contract_address,
      createdAt: dbNFT.created_at,
      data: {
        parcel: {
          x: dbNFT.x as string,
          y: dbNFT.y as string,
          description: dbNFT.description || null,
          estate: {
            name: dbNFT.parcel_estate_name || capitalize(NFTCategory.ESTATE),
            tokenId: dbNFT.parcel_estate_token_id || ''
          }
        }
      },
      id: dbNFT.id,
      image: dbNFT.image,
      issuedId: dbNFT.issued_id,
      itemId: dbNFT.item_id,
      name: dbNFT.name || capitalize(dbNFT.category),
      network: getNetwork(dbNFT.network),
      openRentalId: null,
      owner: dbNFT.owner.toLowerCase(),
      tokenId: dbNFT.token_id,
      soldAt: 0,
      updatedAt: dbNFT.updated_at,
      url: `/contracts/${dbNFT.contract_address}/tokens/${dbNFT.token_id}`
    }

    const result = fromDBNFTToNFT(dbNFT)

    expect(result).toEqual(expectedNFT)
  })

  it('should return the correct NFT object for an ENS DBNFT', () => {
    const dbNFT: DBNFT = {
      id: '3',
      category: NFTCategory.ENS,
      network: Network.ETHEREUM,
      contract_address: '0x789ghi',
      created_at: 1634567890,
      image: 'https://example.com/image.png',
      owner: '0xabcjkl',
      token_id: '789',
      subdomain: 'myensdomain',
      updated_at: 1634567890,
      count: 1,
      sold_at: 0,
      url: 'https:test.com',
      urn: '123:2312',
      issued_id: '123',
      item_id: '123',
      rarity: Rarity.COMMON,
      name: 'Test',
      body_shapes: [],
      item_type: ItemType.SMART_WEARABLE_V1
    }

    const expectedNFT: NFT = {
      activeOrderId: null,
      category: NFTCategory.ENS,
      chainId: getNetworkChainId(dbNFT.network),
      contractAddress: dbNFT.contract_address,
      createdAt: dbNFT.created_at,
      data: {
        ens: {
          subdomain: dbNFT.subdomain as string
        }
      },
      id: dbNFT.id,
      image: dbNFT.image,
      issuedId: dbNFT.issued_id,
      itemId: dbNFT.item_id,
      name: dbNFT.name || capitalize(dbNFT.category),
      network: getNetwork(dbNFT.network),
      openRentalId: null,
      owner: dbNFT.owner.toLowerCase(),
      tokenId: dbNFT.token_id,
      soldAt: 0,
      updatedAt: dbNFT.updated_at,
      url: `/contracts/${dbNFT.contract_address}/tokens/${dbNFT.token_id}`
    }

    const result = fromDBNFTToNFT(dbNFT)

    expect(result).toEqual(expectedNFT)
  })

  it('should return the correct NFT object for an Estate DBNFT', () => {
    const dbNFT: DBNFT = {
      id: '4',
      category: NFTCategory.ESTATE,
      network: Network.ETHEREUM,
      contract_address: '0xdefmno',
      created_at: 1634567890,
      image: 'https://example.com/image.png',
      owner: '0xxyzpqr',
      token_id: '012',
      size: 1,
      description: 'A cool estate NFT',
      estate_parcels: [{ x: 10, y: 20 }],
      updated_at: 1634567890,
      count: 1,
      sold_at: 0,
      url: 'https:test.com',
      urn: '123:2312',
      issued_id: '123',
      item_id: '123',
      rarity: Rarity.COMMON,
      body_shapes: [],
      item_type: ItemType.SMART_WEARABLE_V1,
      name: 'Test'
    }

    const expectedNFT: NFT = {
      activeOrderId: null,
      category: NFTCategory.ESTATE,
      chainId: getNetworkChainId(dbNFT.network),
      contractAddress: dbNFT.contract_address,
      createdAt: dbNFT.created_at,
      data: {
        estate: {
          size: dbNFT.size || 0,
          description: dbNFT.description || null,
          parcels: dbNFT.estate_parcels || []
        }
      },
      id: dbNFT.id,
      image: dbNFT.image,
      issuedId: dbNFT.issued_id,
      itemId: dbNFT.item_id,
      name: dbNFT.name || capitalize(dbNFT.category),
      network: getNetwork(dbNFT.network),
      openRentalId: null,
      owner: dbNFT.owner.toLowerCase(),
      tokenId: dbNFT.token_id,
      soldAt: 0,
      updatedAt: dbNFT.updated_at,
      url: `/contracts/${dbNFT.contract_address}/tokens/${dbNFT.token_id}`
    }

    const result = fromDBNFTToNFT(dbNFT)

    expect(result).toEqual(expectedNFT)
  })

  it('should return the correct NFT object for an emote DBNFT', () => {
    const dbNFT: DBNFT = {
      id: '5',
      category: NFTCategory.EMOTE,
      network: Network.ETHEREUM,
      contract_address: '0xlmnop',
      created_at: 1634567890,
      image: 'https://example.com/image.png',
      owner: '0xuvwxy',
      token_id: '345',
      body_shapes: [BodyShape.FEMALE, BodyShape.MALE],
      emoteCategory: EmoteCategory.DANCE,
      description: 'A cool emote NFT',
      rarity: Rarity.COMMON,
      loop: true,
      has_sound: true,
      has_geometry: true,
      updated_at: 1634567890,
      count: 1,
      sold_at: 0,
      url: 'https:test.com',
      urn: '123:2312',
      issued_id: '123',
      item_id: '123',
      name: 'Test',
      item_type: ItemType.EMOTE_V1
    }

    const expectedNFT: NFT = {
      activeOrderId: null,
      category: NFTCategory.EMOTE,
      chainId: getNetworkChainId(dbNFT.network),
      contractAddress: dbNFT.contract_address,
      createdAt: dbNFT.created_at,
      data: {
        emote: {
          bodyShapes: dbNFT.body_shapes,
          category: dbNFT.emoteCategory as EmoteCategory,
          description: dbNFT.description || '',
          rarity: dbNFT.rarity,
          loop: dbNFT.loop || false,
          hasSound: dbNFT.has_sound || false,
          hasGeometry: dbNFT.has_geometry || false
        }
      },
      id: dbNFT.id,
      image: dbNFT.image,
      issuedId: dbNFT.issued_id,
      itemId: dbNFT.item_id,
      name: dbNFT.name || capitalize(dbNFT.category),
      network: getNetwork(dbNFT.network),
      openRentalId: null,
      owner: dbNFT.owner.toLowerCase(),
      tokenId: dbNFT.token_id,
      soldAt: 0,
      updatedAt: dbNFT.updated_at,
      url: `/contracts/${dbNFT.contract_address}/tokens/${dbNFT.token_id}`
    }

    const result = fromDBNFTToNFT(dbNFT)

    expect(result).toEqual(expectedNFT)
  })
})

describe('fromNFTsAndOrdersToNFTsResult', () => {
  it('should return the correct NFTsResult object', () => {
    const nfts: DBNFT[] = [
      {
        id: '1',
        category: NFTCategory.WEARABLE,
        network: Network.ETHEREUM,
        contract_address: '0x123abc',
        created_at: 1634567890,
        image: 'https://example.com/image.png',
        owner: '0x456def',
        token_id: '123',
        name: 'Wearable NFT',
        body_shapes: [BodyShape.FEMALE, BodyShape.MALE],
        wearableCategory: WearableCategory.HAT,
        description: 'A cool wearable NFT',
        rarity: Rarity.COMMON,
        item_type: ItemType.SMART_WEARABLE_V1,
        updated_at: 1634567890,
        count: 1,
        sold_at: 0,
        url: 'https:test.com',
        urn: '123:2312',
        issued_id: '123',
        item_id: '123'
      },
      {
        id: '2',
        category: NFTCategory.PARCEL,
        network: Network.ETHEREUM,
        contract_address: '0x456def',
        created_at: 1634567890,
        image: 'https://example.com/image.png',
        owner: '0x789ghi',
        token_id: '456',
        x: '10',
        y: '20',
        description: 'A cool parcel NFT',
        parcel_estate_id: '123',
        parcel_estate_name: 'Estate 1',
        parcel_estate_token_id: '789',
        updated_at: 1634567890,
        body_shapes: [],
        item_type: ItemType.EMOTE_V1,
        rarity: Rarity.COMMON,
        count: 1,
        sold_at: 0,
        name: 'Test name',
        url: 'https:test.com',
        urn: '123:2312',
        issued_id: '123',
        item_id: '123'
      }
    ]

    const orders: DBOrder[] = [
      {
        id: '1',
        count: 1,
        marketplace_address: '0xabc123',
        category: NFTCategory.WEARABLE,
        nft_address: '0x123abc',
        token_id: '123',
        owner: '0x456def',
        buyer: '0x789ghi',
        price: '1.0',
        status: ListingStatus.OPEN,
        created_at: Date.now() / 1000,
        expires_at: Date.now() / 1000,
        updated_at: Date.now() / 1000,
        nft_id: '1',
        network: SquidNetwork.ETHEREUM,
        item_id: '123',
        issued_id: '123',
        trade_id: '123'
      },
      {
        id: '2',
        count: 1,
        marketplace_address: '0xdef456',
        category: NFTCategory.PARCEL,
        nft_address: '0x456def',
        token_id: '456',
        owner: '0x789ghi',
        buyer: '0xabcjkl',
        price: '2.0',
        status: ListingStatus.OPEN,
        created_at: Date.now() / 1000,
        expires_at: Date.now() / 1000,
        updated_at: Date.now() / 1000,
        nft_id: '2',
        network: SquidNetwork.ETHEREUM,
        item_id: '456',
        issued_id: '456',
        trade_id: '456'
      }
    ]

    const expectedNFTsResult = [
      { nft: { ...fromDBNFTToNFT(nfts[0]), activeOrderId: orders[0].id }, order: fromDBOrderToOrder(orders[0]), rental: null },
      { nft: { ...fromDBNFTToNFT(nfts[1]), activeOrderId: orders[1].id }, order: fromDBOrderToOrder(orders[1]), rental: null }
    ]

    const result = fromNFTsAndOrdersToNFTsResult(nfts, orders)

    expect(result).toEqual(expectedNFTsResult)
  })
})
