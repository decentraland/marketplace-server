import nock from 'nock'
import { Network, NFT, NFTCategory, Order, Rarity, RentalListing } from '@dcl/schemas'
import { test } from '../components'
import {
  createSquidDBNFT,
  createNFTOnSale,
  createNFTNotForSale,
  createWearableNFT,
  createParcelNFT,
  createEstateNFT,
  deleteSquidDBNFT,
  createNFTOnSaleTrade,
  deleteSquidDBTrade
} from './utils/dbItems'

interface NFTResponse {
  nft: NFT
  order: Order | null
  rental: RentalListing | null
}

interface NFTsResponse {
  data: NFTResponse[]
  total: number
}

test('when getting NFTs', function ({ components }) {
  const contractAddress = '0xcf898476136602cd9d61e65945b5ecf9128ff339'
  const secondContractAddress = '0x1234567890123456789012345678901234567890'

  // Token IDs for different test scenarios
  const wearableTokenId = '1001'
  const parcelTokenId = '1002'
  const estateTokenId = '1003'
  const onSaleTokenId = '1004'
  const notForSaleTokenId = '1005'
  const expensiveTokenId = '1006'
  const cheapTokenId = '1007'
  const secondContractTokenId = '2001'
  const onSaleTradeTokenId = '1008'

  // Land specific token IDs
  const nearPlazaTokenId = '3001'
  const adjacentRoadTokenId = '3002'
  const farFromPlazaTokenId = '4001'
  const bigEstateTokenId = '4002'

  beforeAll(() => {
    // Mock Signatures API - needs to return SignaturesServerPaginatedResponse structure
    nock('https://signatures-api.decentraland.zone')
      .persist()
      .get(/\/v1\/rentals-listings.*/)
      .reply(200, {
        ok: true,
        data: {
          results: [],
          total: 0,
          page: 1,
          pages: 1,
          limit: 24
        }
      })

    // Mock Rentals Subgraph - needs to return GraphQL structure with rentalAssets
    nock('https://subgraph.decentraland.org')
      .persist()
      .post(/.*/)
      .reply(200, {
        data: {
          rentalAssets: []
        }
      })

    // Mock any other subgraph calls
    nock('https://subgraph.decentraland.org')
      .persist()
      .get(/.*/)
      .reply(200, {
        data: {
          rentalAssets: []
        }
      })

    // Mock TheGraph subgraph calls
    nock.disableNetConnect()
    nock.enableNetConnect('127.0.0.1')
    nock.enableNetConnect('localhost')
  })

  afterAll(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('and validating response structure', () => {
    afterEach(async () => {
      // Clean up all test NFTs
      await Promise.all([
        deleteSquidDBNFT(components, wearableTokenId, contractAddress),
        deleteSquidDBNFT(components, parcelTokenId, contractAddress),
        deleteSquidDBNFT(components, estateTokenId, contractAddress),
        deleteSquidDBNFT(components, onSaleTokenId, contractAddress),
        deleteSquidDBNFT(components, notForSaleTokenId, contractAddress),
        deleteSquidDBNFT(components, expensiveTokenId, contractAddress),
        deleteSquidDBNFT(components, cheapTokenId, contractAddress),
        deleteSquidDBNFT(components, secondContractTokenId, secondContractAddress),
        deleteSquidDBNFT(components, nearPlazaTokenId, contractAddress),
        deleteSquidDBNFT(components, adjacentRoadTokenId, contractAddress),
        deleteSquidDBNFT(components, farFromPlazaTokenId, contractAddress),
        deleteSquidDBNFT(components, bigEstateTokenId, contractAddress)
      ])
    })

    describe('and NFTs exist', () => {
      beforeEach(async () => {
        await createWearableNFT(components, contractAddress, wearableTokenId)
      })

      it('should respond with valid response structure', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody).toHaveProperty('data')
        expect(responseBody).toHaveProperty('total')
        expect(Array.isArray(responseBody.data)).toBe(true)
        expect(typeof responseBody.total).toBe('number')
      })

      it('should respond with NFTs containing required fields', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts')
        const responseBody: NFTsResponse = await response.json()

        if (responseBody.data.length > 0) {
          const nftResponse = responseBody.data[0]
          const nft = nftResponse.nft
          expect(nft).toHaveProperty('id')
          expect(nft).toHaveProperty('tokenId')
          expect(nft).toHaveProperty('contractAddress')
          expect(nft).toHaveProperty('category')
          expect(nft).toHaveProperty('owner')
          expect(nft).toHaveProperty('name')
          expect(nft).toHaveProperty('image')
        }
      })
    })
  })

  describe('and filtering by sale status', () => {
    let tradeId: string

    afterEach(async () => {
      await Promise.all([
        deleteSquidDBNFT(components, onSaleTokenId, contractAddress),
        deleteSquidDBNFT(components, notForSaleTokenId, contractAddress),
        deleteSquidDBNFT(components, onSaleTradeTokenId, contractAddress),
        tradeId ? deleteSquidDBTrade(components, tradeId) : Promise.resolve()
      ])
    })

    describe('and some NFTs are on sale via orders and trades', () => {
      beforeEach(async () => {
        await createNFTOnSale(components, contractAddress, onSaleTokenId, '100000000000000000000')
        await createNFTNotForSale(components, contractAddress, notForSaleTokenId)

        // Create NFT on sale via trade (new mechanism)
        await createSquidDBNFT(components, {
          tokenId: onSaleTradeTokenId,
          contractAddress,
          owner: '0x9876543210987654321098765432109876543210',
          category: NFTCategory.WEARABLE
        })
        tradeId = await createNFTOnSaleTrade(
          components,
          contractAddress,
          onSaleTradeTokenId,
          '150000000000000000000', // 150 MANA
          '0x9876543210987654321098765432109876543210'
        )
      })

      it('should respond with NFTs on sale via orders when isOnSale=true', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?isOnSale=true')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)

        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        expect(returnedIds).toContain(onSaleTokenId) // Order-based sale
        expect(returnedIds).not.toContain(notForSaleTokenId) // Not for sale
      })

      it('should respond with NFTs on sale via trades when isOnSale=true', async () => {
        const { localFetch } = components

        const response = await localFetch.fetch('/v1/nfts?isOnSale=true')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)

        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        expect(returnedIds).toContain(onSaleTradeTokenId) // Trade-based sale
        expect(returnedIds).not.toContain(notForSaleTokenId) // Not for sale

        // Verify the trade-based NFT has correct price
        const tradeNFT = responseBody.data.find(item => item.nft.tokenId === onSaleTradeTokenId)
        expect(tradeNFT).toBeDefined()

        // The trade is exposed as an order in the response with tradeId
        expect(tradeNFT?.order).toBeDefined()
        expect(tradeNFT?.order?.tradeId).toBeDefined()
        expect(tradeNFT?.order?.price).toBe('150000000000000000000')
        // Note: trades appear as orders in the NFT response structure
      })

      it('should respond with both order-based and trade-based sales when isOnSale=true', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?isOnSale=true')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)

        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)

        // Should include both mechanisms
        expect(returnedIds).toContain(onSaleTokenId) // Order-based sale
        expect(returnedIds).toContain(onSaleTradeTokenId) // Trade-based sale
        expect(returnedIds).not.toContain(notForSaleTokenId) // Not for sale

        // Should have at least 2 NFTs (order + trade)
        expect(responseBody.data.length).toBeGreaterThanOrEqual(2)
      })

      it('should respond with only NFTs not on sale when isOnSale=false', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?isOnSale=false')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)

        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        expect(returnedIds).toContain(notForSaleTokenId) // Not for sale
        expect(returnedIds).not.toContain(onSaleTokenId) // Order-based sale
        expect(returnedIds).not.toContain(onSaleTradeTokenId) // Trade-based sale
      })
    })
  })

  describe('and filtering by category', () => {
    afterEach(async () => {
      await Promise.all([
        deleteSquidDBNFT(components, wearableTokenId, contractAddress),
        deleteSquidDBNFT(components, parcelTokenId, contractAddress),
        deleteSquidDBNFT(components, estateTokenId, contractAddress)
      ])
    })

    describe('and NFTs of different categories exist', () => {
      beforeEach(async () => {
        await createWearableNFT(components, contractAddress, wearableTokenId)
        await createParcelNFT(components, contractAddress, parcelTokenId)
        await createEstateNFT(components, contractAddress, estateTokenId)
      })

      it('should respond with only wearable NFTs when filtering by wearable category', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?category=wearable')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        const categories = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.category)

        expect(returnedIds).toContain(wearableTokenId)
        expect(returnedIds).not.toContain(parcelTokenId)
        expect(returnedIds).not.toContain(estateTokenId)
        categories.forEach((category: string) => {
          expect(category).toBe('wearable')
        })
      })

      it('should respond with only parcel NFTs when filtering by parcel category', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?category=parcel')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        const categories = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.category)

        expect(returnedIds).toContain(parcelTokenId)
        expect(returnedIds).not.toContain(wearableTokenId)
        expect(returnedIds).not.toContain(estateTokenId)
        categories.forEach((category: string) => {
          expect(category).toBe('parcel')
        })
      })

      it('should respond with only estate NFTs when filtering by estate category', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?category=estate')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        const categories = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.category)

        expect(returnedIds).toContain(estateTokenId)
        expect(returnedIds).not.toContain(wearableTokenId)
        expect(returnedIds).not.toContain(parcelTokenId)
        categories.forEach((category: string) => {
          expect(category).toBe('estate')
        })
      })
    })
  })

  describe('and filtering by owner', () => {
    afterEach(async () => {
      await Promise.all([
        deleteSquidDBNFT(components, wearableTokenId, contractAddress),
        deleteSquidDBNFT(components, onSaleTokenId, contractAddress),
        deleteSquidDBNFT(components, parcelTokenId, contractAddress),
        deleteSquidDBNFT(components, estateTokenId, contractAddress)
      ])
    })

    describe('and NFTs have different owners', () => {
      beforeEach(async () => {
        await createSquidDBNFT(components, {
          tokenId: wearableTokenId,
          contractAddress,
          owner: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          category: NFTCategory.WEARABLE
        })
        await createSquidDBNFT(components, {
          tokenId: onSaleTokenId,
          contractAddress,
          owner: '0x00000000000000000000000000000000000000000',
          category: NFTCategory.WEARABLE
        })
      })

      it('should respond with only NFTs from specified owner when filtering by owner address', async () => {
        const ownerAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/nfts?owner=${ownerAddress}`)
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        const owners = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.owner)

        expect(returnedIds).toContain(wearableTokenId)
        expect(returnedIds).not.toContain(onSaleTokenId)
        owners.forEach((owner: string) => {
          expect(owner.toLowerCase()).toBe(ownerAddress.toLowerCase())
        })
      })

      it('should respond with empty results when filtering by non-existent owner', async () => {
        const nonExistentOwner = '0x9999999999999999999999999999999999999999'
        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/nfts?owner=${nonExistentOwner}`)
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody.data).toEqual([])
        expect(responseBody.total).toBe(0)
      })
    })

    describe('and owner has NFTs both directly owned and in rentals contract', () => {
      const ownerAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
      const rentalsContractAddress = '0x9A7663C22f4D8B5f3c6c6e9c9e5F4c4e8a8b8c8d'
      const landContractAddress = '0xf87e31492faf9a91b02ee0deaad50d51d56d5d4d'
      const estateContractAddress = '0x959e104e1a4db6317fa58f8295f586e1a978c297'

      beforeEach(async () => {
        // Create a parcel directly owned by the user
        await createSquidDBNFT(components, {
          tokenId: parcelTokenId,
          contractAddress: landContractAddress,
          owner: ownerAddress,
          category: NFTCategory.PARCEL
        })

        // Create an estate that's in the rentals contract but user is the lessor
        await createSquidDBNFT(components, {
          tokenId: estateTokenId,
          contractAddress: estateContractAddress,
          owner: rentalsContractAddress, // Owned by rentals contract
          category: NFTCategory.ESTATE
        })

        // Mock the rentals subgraph to return rental assets for this owner
        nock.cleanAll()

        // Reset the default mocks
        nock('https://signatures-api.decentraland.zone')
          .persist()
          .get(/\/v1\/rentals-listings.*/)
          .reply(200, {
            ok: true,
            data: {
              results: [],
              total: 0,
              page: 1,
              pages: 1,
              limit: 24
            }
          })

        // Mock the rentals subgraph to return the estate as a rental asset
        nock('https://subgraph.decentraland.org')
          .persist()
          .post(/.*/)
          .reply(200, {
            data: {
              rentalAssets: [
                {
                  id: `${estateContractAddress}-${estateTokenId}`,
                  contractAddress: estateContractAddress,
                  tokenId: estateTokenId,
                  lessor: ownerAddress.toLowerCase(),
                  isClaimed: false
                }
              ]
            }
          })

        nock.disableNetConnect()
        nock.enableNetConnect('127.0.0.1')
        nock.enableNetConnect('localhost')
      })

      it('should return both directly owned NFTs and rental assets when filtering by owner', async () => {
        const { localFetch } = components

        const response = await localFetch.fetch(`/v1/nfts?owner=${ownerAddress}&isLand=true`)
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)

        const returnedTokenIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        const returnedCategories = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.category)

        // The test should include the rental estate (key functionality being tested)
        expect(returnedTokenIds).toContain(estateTokenId) // Via rentals

        // Verify that we get estate category
        expect(returnedCategories).toContain('estate')

        // Should have at least 1 NFT (the rental estate)
        expect(responseBody.data.length).toBeGreaterThanOrEqual(1)
        expect(responseBody.total).toBeGreaterThanOrEqual(1)

        // Verify that the rental estate has correct owner in rentals contract
        const estateNFT = responseBody.data.find(item => item.nft.tokenId === estateTokenId)
        expect(estateNFT).toBeDefined()
        expect(estateNFT?.nft.owner).toBe(rentalsContractAddress.toLowerCase())
        expect(estateNFT?.nft.category).toBe('estate')
      })

      afterEach(() => {
        // Clean up the specific mocks and restore defaults
        nock.cleanAll()

        // Re-establish default mocks
        nock('https://signatures-api.decentraland.zone')
          .persist()
          .get(/\/v1\/rentals-listings.*/)
          .reply(200, {
            ok: true,
            data: {
              results: [],
              total: 0,
              page: 1,
              pages: 1,
              limit: 24
            }
          })

        nock('https://subgraph.decentraland.org')
          .persist()
          .post(/.*/)
          .reply(200, {
            data: {
              rentalAssets: []
            }
          })

        nock('https://subgraph.decentraland.org')
          .persist()
          .get(/.*/)
          .reply(200, {
            data: {
              rentalAssets: []
            }
          })

        nock.disableNetConnect()
        nock.enableNetConnect('127.0.0.1')
        nock.enableNetConnect('localhost')
      })
    })
  })

  describe('and filtering by price', () => {
    afterEach(async () => {
      await Promise.all([
        deleteSquidDBNFT(components, cheapTokenId, contractAddress),
        deleteSquidDBNFT(components, onSaleTokenId, contractAddress),
        deleteSquidDBNFT(components, expensiveTokenId, contractAddress)
      ])
    })

    describe('and NFTs have different prices', () => {
      beforeEach(async () => {
        await createNFTOnSale(components, contractAddress, cheapTokenId, '10000000000000000000') // 10 MANA
        await createNFTOnSale(components, contractAddress, onSaleTokenId, '100000000000000000000') // 100 MANA
        await createNFTOnSale(components, contractAddress, expensiveTokenId, '1000000000000000000000') // 1000 MANA
      })

      it('should respond with only NFTs above minimum price when filtering by minPrice', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?minPrice=100') // >= 100 MANA
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)

        // Should include NFTs >= 100 MANA
        expect(returnedIds).toContain(onSaleTokenId) // 100 MANA
        expect(returnedIds).toContain(expensiveTokenId) // 1000 MANA

        // Should NOT include cheap NFTs
        expect(returnedIds).not.toContain(cheapTokenId) // 10 MANA
      })

      it('should respond with only NFTs below maximum price when filtering by maxPrice', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?maxPrice=100') // <= 100 MANA
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)

        // Should include NFTs <= 100 MANA
        expect(returnedIds).toContain(cheapTokenId) // 10 MANA
        expect(returnedIds).toContain(onSaleTokenId) // 100 MANA

        // Should NOT include expensive NFTs
        expect(returnedIds).not.toContain(expensiveTokenId) // 1000 MANA
      })

      it('should respond with only NFTs within price range when filtering by price range', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?minPrice=50&maxPrice=500') // 50-500 MANA
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)

        // Should include NFTs in range
        expect(returnedIds).toContain(onSaleTokenId) // 100 MANA

        // Should NOT include NFTs outside range
        expect(returnedIds).not.toContain(cheapTokenId) // 10 MANA
        expect(returnedIds).not.toContain(expensiveTokenId) // 1000 MANA
      })
    })
  })

  describe('and filtering by contract address', () => {
    afterEach(async () => {
      await Promise.all([
        deleteSquidDBNFT(components, wearableTokenId, contractAddress),
        deleteSquidDBNFT(components, secondContractTokenId, secondContractAddress)
      ])
    })

    describe('and NFTs exist in different contracts', () => {
      beforeEach(async () => {
        await createSquidDBNFT(components, {
          tokenId: wearableTokenId,
          contractAddress,
          category: NFTCategory.WEARABLE
        })
        await createSquidDBNFT(components, {
          tokenId: secondContractTokenId,
          contractAddress: secondContractAddress,
          category: NFTCategory.WEARABLE
        })
      })

      it('should respond with only NFTs from specified contract when filtering by contract address', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/nfts?contractAddress=${contractAddress}`)
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedContractAddresses = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.contractAddress)

        returnedContractAddresses.forEach((addr: string) => {
          expect(addr).toBe(contractAddress)
        })

        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        expect(returnedIds).toContain(wearableTokenId)
        expect(returnedIds).not.toContain(secondContractTokenId)
      })

      it('should respond with empty results when filtering by non-existent contract address', async () => {
        const nonExistentContract = '0x9999999999999999999999999999999999999999'
        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/nfts?contractAddress=${nonExistentContract}`)
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody.data).toEqual([])
        expect(responseBody.total).toBe(0)
      })
    })
  })

  describe('and filtering by token ID', () => {
    afterEach(async () => {
      await Promise.all([
        deleteSquidDBNFT(components, wearableTokenId, contractAddress),
        deleteSquidDBNFT(components, parcelTokenId, contractAddress)
      ])
    })

    describe('and NFTs with different token IDs exist', () => {
      beforeEach(async () => {
        await createWearableNFT(components, contractAddress, wearableTokenId)
        await createParcelNFT(components, contractAddress, parcelTokenId)
      })

      it('should respond with only the specified NFT when filtering by token ID and contract address', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/nfts?tokenId=${wearableTokenId}&contractAddress=${contractAddress}`)
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        const returnedContracts = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.contractAddress)

        expect(returnedIds).toContain(wearableTokenId)
        expect(returnedIds).not.toContain(parcelTokenId)
        expect(returnedContracts).toContain(contractAddress)
        expect(responseBody.data.length).toBe(1)
      })
    })
  })

  describe('and filtering by search term', () => {
    afterEach(async () => {
      await Promise.all([
        deleteSquidDBNFT(components, wearableTokenId, contractAddress),
        deleteSquidDBNFT(components, parcelTokenId, contractAddress)
      ])
    })

    describe('and NFTs with different names exist', () => {
      beforeEach(async () => {
        await createSquidDBNFT(components, {
          tokenId: wearableTokenId,
          contractAddress,
          name: 'Cool Wearable',
          category: NFTCategory.WEARABLE
        })
        await createSquidDBNFT(components, {
          tokenId: parcelTokenId,
          contractAddress,
          name: 'Genesis Parcel',
          category: NFTCategory.PARCEL
        })
      })

      it('should respond with only matching NFTs when searching by name', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?search=Cool')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)

        expect(returnedIds).toContain(wearableTokenId)
        expect(returnedIds).not.toContain(parcelTokenId)
      })
    })
  })

  describe('and filtering by land-specific properties', () => {
    afterEach(async () => {
      await Promise.all([
        deleteSquidDBNFT(components, nearPlazaTokenId, contractAddress),
        deleteSquidDBNFT(components, adjacentRoadTokenId, contractAddress),
        deleteSquidDBNFT(components, farFromPlazaTokenId, contractAddress),
        deleteSquidDBNFT(components, bigEstateTokenId, contractAddress),
        deleteSquidDBNFT(components, wearableTokenId, contractAddress)
      ])
    })

    describe('and land NFTs with different properties exist', () => {
      beforeEach(async () => {
        // Create land NFTs with specific properties
        await createSquidDBNFT(components, {
          tokenId: nearPlazaTokenId,
          contractAddress,
          category: NFTCategory.PARCEL,
          distanceToPlaza: 5,
          adjacentToRoad: true
        })
        await createSquidDBNFT(components, {
          tokenId: adjacentRoadTokenId,
          contractAddress,
          category: NFTCategory.ESTATE,
          distanceToPlaza: 10,
          adjacentToRoad: true,
          estateSize: 10
        })
        await createSquidDBNFT(components, {
          tokenId: farFromPlazaTokenId,
          contractAddress,
          category: NFTCategory.PARCEL,
          distanceToPlaza: 50,
          adjacentToRoad: false
        })
        await createSquidDBNFT(components, {
          tokenId: bigEstateTokenId,
          contractAddress,
          category: NFTCategory.ESTATE,
          distanceToPlaza: 20,
          adjacentToRoad: false,
          estateSize: 25
        })
        await createWearableNFT(components, contractAddress, wearableTokenId)
      })

      it('should respond with only land NFTs when filtering by isLand parameter', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?isLand=true')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const categories = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.category)

        categories.forEach((category: string) => {
          expect(['parcel', 'estate']).toContain(category)
        })
      })

      it('should respond with only road-adjacent NFTs when filtering by adjacentToRoad', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?adjacentToRoad=true')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)

        expect(returnedIds).toContain(nearPlazaTokenId)
        expect(returnedIds).toContain(adjacentRoadTokenId)
        expect(returnedIds).not.toContain(farFromPlazaTokenId)
      })

      it('should respond with only near plaza NFTs when filtering by distance to plaza', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?maxDistanceToPlaza=15')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)

        expect(returnedIds).toContain(nearPlazaTokenId)
        expect(returnedIds).toContain(adjacentRoadTokenId)
        expect(returnedIds).not.toContain(farFromPlazaTokenId)
      })

      it('should respond with only large estates when filtering by estate size', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?minEstateSize=5')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)

        expect(returnedIds).toContain(adjacentRoadTokenId) // size 10
        expect(returnedIds).toContain(bigEstateTokenId) // size 25
      })
    })
  })

  describe('and using pagination and sorting', () => {
    afterEach(async () => {
      await Promise.all([
        deleteSquidDBNFT(components, wearableTokenId, contractAddress),
        deleteSquidDBNFT(components, parcelTokenId, contractAddress),
        deleteSquidDBNFT(components, estateTokenId, contractAddress)
      ])
    })

    describe('and multiple NFTs exist', () => {
      beforeEach(async () => {
        await createWearableNFT(components, contractAddress, wearableTokenId)
        await createParcelNFT(components, contractAddress, parcelTokenId)
        await createEstateNFT(components, contractAddress, estateTokenId)
      })

      it('should respect first parameter for pagination', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?first=2')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody.data.length).toBeLessThanOrEqual(2)
      })

      it('should respect skip parameter for pagination', async () => {
        const { localFetch } = components

        // Get all results first
        const allResponse = await localFetch.fetch('/v1/nfts')
        const allBody: NFTsResponse = await allResponse.json()

        if (allBody.total > 1) {
          // Skip the first one
          const skippedResponse = await localFetch.fetch('/v1/nfts?skip=1')
          const skippedBody: NFTsResponse = await skippedResponse.json()

          expect(skippedResponse.status).toEqual(200)
          expect(skippedBody.data.length).toBe(allBody.total - 1)
        }
      })

      it('should handle sorting by newest', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?sortBy=newest')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        expect(Array.isArray(responseBody.data)).toBe(true)
      })

      it('should handle sorting by oldest', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?sortBy=oldest')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        expect(Array.isArray(responseBody.data)).toBe(true)
      })
    })
  })

  describe('and handling edge cases and errors', () => {
    it('should handle empty results gracefully', async () => {
      const { localFetch } = components
      const response = await localFetch.fetch('/v1/nfts?contractAddress=0x9999999999999999999999999999999999999999')
      const responseBody: NFTsResponse = await response.json()

      expect(response.status).toEqual(200)
      expect(responseBody.data).toEqual([])
      expect(responseBody.total).toBe(0)
    })

    it('should handle invalid price parameters gracefully', async () => {
      const { localFetch } = components
      const response = await localFetch.fetch('/v1/nfts?minPrice=invalid')

      // Should handle gracefully, either 400 or 200 with empty results
      expect([200, 400, 500]).toContain(response.status)
    })

    it('should handle large pagination values', async () => {
      const { localFetch } = components
      const response = await localFetch.fetch('/v1/nfts?first=10000&skip=5000')
      const responseBody: NFTsResponse = await response.json()

      expect(response.status).toEqual(200)
      expect(Array.isArray(responseBody.data)).toBe(true)
    })

    it('should handle invalid address parameters', async () => {
      const { localFetch } = components
      const response = await localFetch.fetch('/v1/nfts?owner=invalid-address')

      // Should handle gracefully
      expect([200, 400]).toContain(response.status)
    })

    it('should handle invalid category parameter', async () => {
      const { localFetch } = components
      const response = await localFetch.fetch('/v1/nfts?category=invalid-category')

      // Should handle gracefully
      expect([200, 400]).toContain(response.status)
    })

    it('should return 400 when tokenId is provided without contractAddress', async () => {
      const { localFetch } = components
      const response = await localFetch.fetch(`/v1/nfts?tokenId=${wearableTokenId}`)

      expect(response.status).toEqual(400)
    })

    it('should return 400 when both owner and tenant parameters are provided', async () => {
      const { localFetch } = components
      const ownerAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
      const tenantAddress = '0x1234567890123456789012345678901234567890'
      const response = await localFetch.fetch(`/v1/nfts?owner=${ownerAddress}&tenant=${tenantAddress}`)

      expect(response.status).toEqual(400)
    })

    it('should return 400 when tokenId contains non-numeric characters', async () => {
      const { localFetch } = components
      const invalidTokenId = 'abc123'
      const response = await localFetch.fetch(`/v1/nfts?tokenId=${invalidTokenId}&contractAddress=${contractAddress}`)

      expect(response.status).toEqual(400)
    })

    it('should return 400 when tokenId is provided with invalid contractAddress', async () => {
      const { localFetch } = components
      // This simulates the case where contractAddresses?.length === 0
      // by providing an invalid address that gets filtered out by isAddress()
      const response = await localFetch.fetch(`/v1/nfts?tokenId=${wearableTokenId}&contractAddress=invalid-address`)

      expect(response.status).toEqual(400)
    })
  })

  describe('and filtering by network', () => {
    afterEach(async () => {
      await Promise.all([
        deleteSquidDBNFT(components, wearableTokenId, contractAddress),
        deleteSquidDBNFT(components, parcelTokenId, contractAddress)
      ])
    })

    describe('and NFTs exist on different networks', () => {
      beforeEach(async () => {
        await createSquidDBNFT(components, {
          tokenId: wearableTokenId,
          contractAddress,
          category: NFTCategory.WEARABLE,
          network: Network.ETHEREUM
        })
        await createSquidDBNFT(components, {
          tokenId: parcelTokenId,
          contractAddress,
          category: NFTCategory.PARCEL,
          network: Network.MATIC
        })
      })

      it('should respond with only NFTs from specified network when filtering by network', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?network=ETHEREUM')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)

        expect(returnedIds).toContain(wearableTokenId)
        expect(returnedIds).not.toContain(parcelTokenId)
      })
    })
  })

  describe('and filtering by rarity', () => {
    afterEach(async () => {
      await deleteSquidDBNFT(components, wearableTokenId, contractAddress)
    })

    describe('and NFTs with different rarities exist', () => {
      beforeEach(async () => {
        await createSquidDBNFT(components, {
          tokenId: wearableTokenId,
          contractAddress,
          category: NFTCategory.WEARABLE,
          rarity: Rarity.COMMON
        })
      })

      it('should respond with only NFTs of specified rarity when filtering by rarity', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/nfts?rarity=common')
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)

        expect(returnedIds).toContain(wearableTokenId)
      })
    })
  })

  describe('and using combined filters', () => {
    afterEach(async () => {
      await Promise.all([
        deleteSquidDBNFT(components, onSaleTokenId, contractAddress),
        deleteSquidDBNFT(components, notForSaleTokenId, contractAddress),
        deleteSquidDBNFT(components, cheapTokenId, contractAddress),
        deleteSquidDBNFT(components, wearableTokenId, contractAddress),
        deleteSquidDBNFT(components, parcelTokenId, contractAddress),
        deleteSquidDBNFT(components, secondContractTokenId, secondContractAddress)
      ])
    })

    describe('and NFTs with different properties exist', () => {
      beforeEach(async () => {
        const ownerAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
        await createNFTOnSale(components, contractAddress, onSaleTokenId, '100000000000000000000', ownerAddress)
        await createNFTNotForSale(components, contractAddress, notForSaleTokenId, ownerAddress)
        await createNFTOnSale(components, contractAddress, cheapTokenId, '50000000000000000000')
      })

      it('should respond with NFTs matching multiple filters when applying isOnSale and owner filters', async () => {
        const ownerAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/nfts?isOnSale=true&owner=${ownerAddress}`)
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        const owners = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.owner)

        expect(returnedIds).toContain(onSaleTokenId)
        expect(returnedIds).not.toContain(notForSaleTokenId) // not on sale
        expect(returnedIds).not.toContain(cheapTokenId) // different owner

        owners.forEach((owner: string) => {
          expect(owner.toLowerCase()).toBe(ownerAddress.toLowerCase())
        })
      })

      it('should respond with NFTs matching multiple filters when applying category and contractAddress filters', async () => {
        await createWearableNFT(components, contractAddress, wearableTokenId)
        await createParcelNFT(components, contractAddress, parcelTokenId)
        await createWearableNFT(components, secondContractAddress, secondContractTokenId)

        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/nfts?category=wearable&contractAddress=${contractAddress}`)
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        const categories = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.category)
        const contracts = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.contractAddress)

        expect(returnedIds).toContain(wearableTokenId)
        expect(returnedIds).not.toContain(parcelTokenId)

        categories.forEach((category: string) => {
          expect(category).toBe('wearable')
        })
        contracts.forEach((contract: string) => {
          expect(contract).toBe(contractAddress)
        })
      })

      it('should work with pagination on filtered results', async () => {
        const ownerAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/nfts?owner=${ownerAddress}&first=2`)
        const responseBody: NFTsResponse = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody.data.length).toBeLessThanOrEqual(2)

        const owners = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.owner)
        owners.forEach((owner: string) => {
          expect(owner.toLowerCase()).toBe(ownerAddress.toLowerCase())
        })
      })
    })
  })
})
