import nock from 'nock'
import { Response } from 'node-fetch'
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

// Helper functions for mocks
function mockSignaturesAPI(): void {
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
}

function mockRentalsSubgraph(rentalAssets: any[] = []): void {
  nock('https://subgraph.decentraland.org')
    .persist()
    .post(/.*/)
    .reply(200, {
      data: {
        rentalAssets
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
}

function setupDefaultMocks(): void {
  mockSignaturesAPI()
  mockRentalsSubgraph()
  nock.disableNetConnect()
  nock.enableNetConnect('localhost')
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
  const smallEstateTokenId = '4003'

  beforeEach(() => {
    setupDefaultMocks()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('and validating response structure', () => {
    afterEach(async () => {
      await deleteSquidDBNFT(components, wearableTokenId, contractAddress)
    })

    describe('when NFTs exist', () => {
      let response: Response
      let responseBody: NFTsResponse

      beforeEach(async () => {
        await createWearableNFT(components, contractAddress, wearableTokenId)
        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts')
        responseBody = await response.json()
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should respond with data array', async () => {
        expect(responseBody).toHaveProperty('data')
        expect(Array.isArray(responseBody.data)).toBe(true)
      })

      it('should respond with total count', async () => {
        expect(responseBody).toHaveProperty('total')
        expect(typeof responseBody.total).toBe('number')
      })

      it('should respond with at least one NFT with all required fields', async () => {
        expect(responseBody.data.length).toBeGreaterThan(0)
        const nftResponse = responseBody.data[0]
        const nft = nftResponse.nft
        expect(nft).toHaveProperty('id')
        expect(nft).toHaveProperty('tokenId')
        expect(nft).toHaveProperty('contractAddress')
        expect(nft).toHaveProperty('category')
        expect(nft).toHaveProperty('owner')
        expect(nft).toHaveProperty('name')
        expect(nft).toHaveProperty('image')
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

    describe('when isOnSale filter is true', () => {
      describe('and some NFTs are on sale via orders', () => {
        let response: Response
        let responseBody: NFTsResponse
        let returnedIds: string[]

        beforeEach(async () => {
          await createNFTOnSale(components, contractAddress, onSaleTokenId, '100000000000000000000')
          await createNFTNotForSale(components, contractAddress, notForSaleTokenId)

          const { localFetch } = components
          response = await localFetch.fetch('/v1/nfts?isOnSale=true')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        })

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should include NFTs on sale via orders', async () => {
          expect(returnedIds).toContain(onSaleTokenId)
        })

        it('should not include NFTs not for sale', async () => {
          expect(returnedIds).not.toContain(notForSaleTokenId)
        })
      })

      describe('and some NFTs are on sale via trades', () => {
        let response: Response
        let responseBody: NFTsResponse
        let returnedIds: string[]

        beforeEach(async () => {
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
          await createNFTNotForSale(components, contractAddress, notForSaleTokenId)

          const { localFetch } = components
          response = await localFetch.fetch('/v1/nfts?isOnSale=true')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        })

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should include NFTs on sale via trades', async () => {
          expect(returnedIds).toContain(onSaleTradeTokenId)
        })

        it('should not include NFTs not for sale', async () => {
          expect(returnedIds).not.toContain(notForSaleTokenId)
        })

        it('should expose trade as order with correct price', async () => {
          const tradeNFT = responseBody.data.find(item => item.nft.tokenId === onSaleTradeTokenId)
          expect(tradeNFT).toBeDefined()
          expect(tradeNFT?.order).toBeDefined()
          expect(tradeNFT?.order?.tradeId).toBeDefined()
          expect(tradeNFT?.order?.price).toBe('150000000000000000000')
        })
      })

      describe('and NFTs are on sale via both orders and trades', () => {
        let response: Response
        let responseBody: NFTsResponse
        let returnedIds: string[]

        beforeEach(async () => {
          await createNFTOnSale(components, contractAddress, onSaleTokenId, '100000000000000000000')
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
            '150000000000000000000',
            '0x9876543210987654321098765432109876543210'
          )
          await createNFTNotForSale(components, contractAddress, notForSaleTokenId)

          const { localFetch } = components
          response = await localFetch.fetch('/v1/nfts?isOnSale=true')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        })

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should include all NFTs on sale', async () => {
          expect(returnedIds).toContain(onSaleTokenId)
          expect(returnedIds).toContain(onSaleTradeTokenId)
        })

        it('should not include NFTs not for sale', async () => {
          expect(returnedIds).not.toContain(notForSaleTokenId)
        })

        it('should return at least two NFTs', async () => {
          expect(responseBody.data.length).toBeGreaterThanOrEqual(2)
        })
      })
    })

    describe('when isOnSale filter is false', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]

      beforeEach(async () => {
        await createNFTOnSale(components, contractAddress, onSaleTokenId, '100000000000000000000')
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
          '150000000000000000000',
          '0x9876543210987654321098765432109876543210'
        )
        await createNFTNotForSale(components, contractAddress, notForSaleTokenId)

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?isOnSale=false')
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include NFTs not for sale', async () => {
        expect(returnedIds).toContain(notForSaleTokenId)
      })

      it('should not include NFTs on sale via orders', async () => {
        expect(returnedIds).not.toContain(onSaleTokenId)
      })

      it('should not include NFTs on sale via trades', async () => {
        expect(returnedIds).not.toContain(onSaleTradeTokenId)
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

    describe('when category filter is wearable', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]
      let categories: string[]

      beforeEach(async () => {
        await createWearableNFT(components, contractAddress, wearableTokenId)
        await createParcelNFT(components, contractAddress, parcelTokenId)
        await createEstateNFT(components, contractAddress, estateTokenId)

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?category=wearable')
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        categories = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.category)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include only wearable NFTs', async () => {
        expect(returnedIds).toContain(wearableTokenId)
      })

      it('should not include parcel NFTs', async () => {
        expect(returnedIds).not.toContain(parcelTokenId)
      })

      it('should not include estate NFTs', async () => {
        expect(returnedIds).not.toContain(estateTokenId)
      })

      it('should only return wearable category', async () => {
        categories.forEach((category: string) => {
          expect(category).toBe('wearable')
        })
      })
    })

    describe('when category filter is parcel', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]
      let categories: string[]

      beforeEach(async () => {
        await createWearableNFT(components, contractAddress, wearableTokenId)
        await createParcelNFT(components, contractAddress, parcelTokenId)
        await createEstateNFT(components, contractAddress, estateTokenId)

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?category=parcel')
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        categories = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.category)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include only parcel NFTs', async () => {
        expect(returnedIds).toContain(parcelTokenId)
      })

      it('should not include wearable NFTs', async () => {
        expect(returnedIds).not.toContain(wearableTokenId)
      })

      it('should not include estate NFTs', async () => {
        expect(returnedIds).not.toContain(estateTokenId)
      })

      it('should only return parcel category', async () => {
        categories.forEach((category: string) => {
          expect(category).toBe('parcel')
        })
      })
    })

    describe('when category filter is estate', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]
      let categories: string[]

      beforeEach(async () => {
        await createWearableNFT(components, contractAddress, wearableTokenId)
        await createParcelNFT(components, contractAddress, parcelTokenId)
        await createEstateNFT(components, contractAddress, estateTokenId)

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?category=estate')
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        categories = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.category)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include only estate NFTs', async () => {
        expect(returnedIds).toContain(estateTokenId)
      })

      it('should not include wearable NFTs', async () => {
        expect(returnedIds).not.toContain(wearableTokenId)
      })

      it('should not include parcel NFTs', async () => {
        expect(returnedIds).not.toContain(parcelTokenId)
      })

      it('should only return estate category', async () => {
        categories.forEach((category: string) => {
          expect(category).toBe('estate')
        })
      })
    })

    describe('when category filter is invalid', () => {
      let response: Response

      beforeEach(async () => {
        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?category=invalid-category')
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
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

    describe('when owner address is specified', () => {
      const ownerAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]
      let owners: string[]

      beforeEach(async () => {
        await createSquidDBNFT(components, {
          tokenId: wearableTokenId,
          contractAddress,
          owner: ownerAddress,
          category: NFTCategory.WEARABLE
        })
        await createSquidDBNFT(components, {
          tokenId: onSaleTokenId,
          contractAddress,
          owner: '0x00000000000000000000000000000000000000000',
          category: NFTCategory.WEARABLE
        })

        const { localFetch } = components
        response = await localFetch.fetch(`/v1/nfts?owner=${ownerAddress}`)
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        owners = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.owner)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include NFTs from specified owner', async () => {
        expect(returnedIds).toContain(wearableTokenId)
      })

      it('should not include NFTs from other owners', async () => {
        expect(returnedIds).not.toContain(onSaleTokenId)
      })

      it('should only return NFTs from specified owner address', async () => {
        owners.forEach((owner: string) => {
          expect(owner.toLowerCase()).toBe(ownerAddress.toLowerCase())
        })
      })
    })

    describe('when owner address does not exist', () => {
      const nonExistentOwner = '0x9999999999999999999999999999999999999999'
      let response: Response
      let responseBody: NFTsResponse

      beforeEach(async () => {
        const { localFetch } = components
        response = await localFetch.fetch(`/v1/nfts?owner=${nonExistentOwner}`)
        responseBody = await response.json()
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should respond with empty data array', async () => {
        expect(responseBody.data).toEqual([])
      })

      it('should respond with zero total', async () => {
        expect(responseBody.total).toBe(0)
      })
    })

    describe('when owner address is invalid', () => {
      let response: Response

      beforeEach(async () => {
        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?owner=invalid-address')
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })
    })

    describe('when owner has NFTs in rentals contract', () => {
      const ownerAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
      const rentalsContractAddress = '0x9A7663C22f4D8B5f3c6c6e9c9e5F4c4e8a8b8c8d'
      const landContractAddress = '0xf87e31492faf9a91b02ee0deaad50d51d56d5d4d'
      const estateContractAddress = '0x959e104e1a4db6317fa58f8295f586e1a978c297'

      let response: Response
      let responseBody: NFTsResponse
      let returnedTokenIds: string[]
      let returnedCategories: string[]

      beforeEach(async () => {
        await createSquidDBNFT(components, {
          tokenId: parcelTokenId,
          contractAddress: landContractAddress,
          owner: ownerAddress,
          category: NFTCategory.PARCEL
        })

        await createSquidDBNFT(components, {
          tokenId: estateTokenId,
          contractAddress: estateContractAddress,
          owner: rentalsContractAddress,
          category: NFTCategory.ESTATE
        })

        nock.cleanAll()
        mockSignaturesAPI()
        mockRentalsSubgraph([
          {
            id: `${estateContractAddress}-${estateTokenId}`,
            contractAddress: estateContractAddress,
            tokenId: estateTokenId,
            lessor: ownerAddress.toLowerCase(),
            isClaimed: false
          }
        ])
        nock.disableNetConnect()
        nock.enableNetConnect('localhost')

        const { localFetch } = components
        response = await localFetch.fetch(`/v1/nfts?owner=${ownerAddress}&isLand=true`)
        responseBody = await response.json()
        returnedTokenIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        returnedCategories = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.category)
      })

      afterEach(() => {
        nock.cleanAll()
        setupDefaultMocks()
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include rental assets where owner is lessor', async () => {
        expect(returnedTokenIds).toContain(estateTokenId)
      })

      it('should include estate category', async () => {
        expect(returnedCategories).toContain('estate')
      })

      it('should return at least one NFT', async () => {
        expect(responseBody.data.length).toBeGreaterThanOrEqual(1)
        expect(responseBody.total).toBeGreaterThanOrEqual(1)
      })

      it('should show correct owner for rental estate', async () => {
        const estateNFT = responseBody.data.find(item => item.nft.tokenId === estateTokenId)
        expect(estateNFT).toBeDefined()
        expect(estateNFT?.nft.owner).toBe(rentalsContractAddress.toLowerCase())
        expect(estateNFT?.nft.category).toBe('estate')
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

    describe('when minPrice filter is set', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]

      beforeEach(async () => {
        await createNFTOnSale(components, contractAddress, cheapTokenId, '10000000000000000000') // 10 MANA
        await createNFTOnSale(components, contractAddress, onSaleTokenId, '100000000000000000000') // 100 MANA
        await createNFTOnSale(components, contractAddress, expensiveTokenId, '1000000000000000000000') // 1000 MANA

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?minPrice=100') // >= 100 MANA
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include NFTs at or above minimum price', async () => {
        expect(returnedIds).toContain(onSaleTokenId) // 100 MANA
        expect(returnedIds).toContain(expensiveTokenId) // 1000 MANA
      })

      it('should not include NFTs below minimum price', async () => {
        expect(returnedIds).not.toContain(cheapTokenId) // 10 MANA
      })
    })

    describe('when maxPrice filter is set', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]

      beforeEach(async () => {
        await createNFTOnSale(components, contractAddress, cheapTokenId, '10000000000000000000') // 10 MANA
        await createNFTOnSale(components, contractAddress, onSaleTokenId, '100000000000000000000') // 100 MANA
        await createNFTOnSale(components, contractAddress, expensiveTokenId, '1000000000000000000000') // 1000 MANA

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?maxPrice=100') // <= 100 MANA
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include NFTs at or below maximum price', async () => {
        expect(returnedIds).toContain(cheapTokenId) // 10 MANA
        expect(returnedIds).toContain(onSaleTokenId) // 100 MANA
      })

      it('should not include NFTs above maximum price', async () => {
        expect(returnedIds).not.toContain(expensiveTokenId) // 1000 MANA
      })
    })

    describe('when both minPrice and maxPrice filters are set', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]

      beforeEach(async () => {
        await createNFTOnSale(components, contractAddress, cheapTokenId, '10000000000000000000') // 10 MANA
        await createNFTOnSale(components, contractAddress, onSaleTokenId, '100000000000000000000') // 100 MANA
        await createNFTOnSale(components, contractAddress, expensiveTokenId, '1000000000000000000000') // 1000 MANA

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?minPrice=50&maxPrice=500') // 50-500 MANA
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include NFTs within price range', async () => {
        expect(returnedIds).toContain(onSaleTokenId) // 100 MANA
      })

      it('should not include NFTs outside price range', async () => {
        expect(returnedIds).not.toContain(cheapTokenId) // 10 MANA
        expect(returnedIds).not.toContain(expensiveTokenId) // 1000 MANA
      })
    })

      describe('when price parameter is invalid', () => {
        let response: Response

        beforeEach(async () => {
          const { localFetch } = components
          response = await localFetch.fetch('/v1/nfts?minPrice=invalid')
        })

        it('should respond with 400 status', async () => {
          expect(response.status).toEqual(400)
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

    describe('when contract address is specified', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]
      let returnedContractAddresses: string[]

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

        const { localFetch } = components
        response = await localFetch.fetch(`/v1/nfts?contractAddress=${contractAddress}`)
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        returnedContractAddresses = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.contractAddress)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include NFTs from specified contract', async () => {
        expect(returnedIds).toContain(wearableTokenId)
      })

      it('should not include NFTs from other contracts', async () => {
        expect(returnedIds).not.toContain(secondContractTokenId)
      })

      it('should only return NFTs from specified contract address', async () => {
        returnedContractAddresses.forEach((addr: string) => {
          expect(addr).toBe(contractAddress)
        })
      })
    })

    describe('when contract address does not exist', () => {
      const nonExistentContract = '0x9999999999999999999999999999999999999999'
      let response: Response
      let responseBody: NFTsResponse

      beforeEach(async () => {
        const { localFetch } = components
        response = await localFetch.fetch(`/v1/nfts?contractAddress=${nonExistentContract}`)
        responseBody = await response.json()
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should respond with empty data array', async () => {
        expect(responseBody.data).toEqual([])
      })

      it('should respond with zero total', async () => {
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

    describe('when tokenId and contractAddress are specified', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]
      let returnedContracts: string[]

      beforeEach(async () => {
        await createWearableNFT(components, contractAddress, wearableTokenId)
        await createParcelNFT(components, contractAddress, parcelTokenId)

        const { localFetch } = components
        response = await localFetch.fetch(`/v1/nfts?tokenId=${wearableTokenId}&contractAddress=${contractAddress}`)
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        returnedContracts = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.contractAddress)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include specified NFT', async () => {
        expect(returnedIds).toContain(wearableTokenId)
      })

      it('should not include other NFTs', async () => {
        expect(returnedIds).not.toContain(parcelTokenId)
      })

      it('should include specified contract address', async () => {
        expect(returnedContracts).toContain(contractAddress)
      })

      it('should return exactly one NFT', async () => {
        expect(responseBody.data.length).toBe(1)
      })
    })

    describe('when tokenId is provided without contractAddress', () => {
      let response: Response

      beforeEach(async () => {
        const { localFetch } = components
        response = await localFetch.fetch(`/v1/nfts?tokenId=${wearableTokenId}`)
      })

      it('should respond with 400 status', async () => {
        expect(response.status).toEqual(400)
      })
    })

    describe('when tokenId contains non-numeric characters', () => {
      let response: Response

      beforeEach(async () => {
        const invalidTokenId = 'abc123'
        const { localFetch } = components
        response = await localFetch.fetch(`/v1/nfts?tokenId=${invalidTokenId}&contractAddress=${contractAddress}`)
      })

      it('should respond with 400 status', async () => {
        expect(response.status).toEqual(400)
      })
    })

    describe('when tokenId is provided with invalid contractAddress', () => {
      let response: Response

      beforeEach(async () => {
        const { localFetch } = components
        response = await localFetch.fetch(`/v1/nfts?tokenId=${wearableTokenId}&contractAddress=invalid-address`)
      })

      it('should respond with 400 status', async () => {
        expect(response.status).toEqual(400)
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

    describe('when search term matches NFT name', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]

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

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?search=Cool')
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include matching NFTs', async () => {
        expect(returnedIds).toContain(wearableTokenId)
      })

      it('should not include non-matching NFTs', async () => {
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
        deleteSquidDBNFT(components, smallEstateTokenId, contractAddress),
        deleteSquidDBNFT(components, wearableTokenId, contractAddress)
      ])
    })

    describe('when isLand filter is true', () => {
      let response: Response
      let responseBody: NFTsResponse
      let categories: string[]

      beforeEach(async () => {
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
        await createWearableNFT(components, contractAddress, wearableTokenId)

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?isLand=true')
        responseBody = await response.json()
        categories = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.category)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should only return land NFTs', async () => {
        categories.forEach((category: string) => {
          expect(['parcel', 'estate']).toContain(category)
        })
      })
    })

    describe('when adjacentToRoad filter is true', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]

      beforeEach(async () => {
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

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?adjacentToRoad=true')
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include road-adjacent NFTs', async () => {
        expect(returnedIds).toContain(nearPlazaTokenId)
        expect(returnedIds).toContain(adjacentRoadTokenId)
      })

      it('should not include non-road-adjacent NFTs', async () => {
        expect(returnedIds).not.toContain(farFromPlazaTokenId)
      })
    })

    describe('when maxDistanceToPlaza filter is set', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]

      beforeEach(async () => {
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

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?maxDistanceToPlaza=15')
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include near plaza NFTs', async () => {
        expect(returnedIds).toContain(nearPlazaTokenId)
        expect(returnedIds).toContain(adjacentRoadTokenId)
      })

      it('should not include far from plaza NFTs', async () => {
        expect(returnedIds).not.toContain(farFromPlazaTokenId)
      })
    })

    describe('when minEstateSize filter is set', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]

      beforeEach(async () => {
        await createSquidDBNFT(components, {
          tokenId: smallEstateTokenId,
          contractAddress,
          category: NFTCategory.ESTATE,
          distanceToPlaza: 20,
          adjacentToRoad: false,
          estateSize: 3
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
          tokenId: bigEstateTokenId,
          contractAddress,
          category: NFTCategory.ESTATE,
          distanceToPlaza: 20,
          adjacentToRoad: false,
          estateSize: 25
        })

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?minEstateSize=5&isLand=true')
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include large estates', async () => {
        expect(returnedIds).toContain(adjacentRoadTokenId) // size 10
        expect(returnedIds).toContain(bigEstateTokenId) // size 25
      })

      it('should not include small estates', async () => {
        expect(returnedIds).not.toContain(smallEstateTokenId) // size 3
      })
    })

    describe('when maxEstateSize filter is set', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]

      beforeEach(async () => {
        await createSquidDBNFT(components, {
          tokenId: smallEstateTokenId,
          contractAddress,
          category: NFTCategory.ESTATE,
          distanceToPlaza: 20,
          adjacentToRoad: false,
          estateSize: 3
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
          tokenId: bigEstateTokenId,
          contractAddress,
          category: NFTCategory.ESTATE,
          distanceToPlaza: 20,
          adjacentToRoad: false,
          estateSize: 25
        })

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?maxEstateSize=10&isLand=true')
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include small and medium estates', async () => {
        expect(returnedIds).toContain(smallEstateTokenId) // size 3
        expect(returnedIds).toContain(adjacentRoadTokenId) // size 10
      })

      it('should not include large estates', async () => {
        expect(returnedIds).not.toContain(bigEstateTokenId) // size 25
      })
    })
  })

  describe('and using pagination', () => {
    afterEach(async () => {
      await Promise.all([
        deleteSquidDBNFT(components, wearableTokenId, contractAddress),
        deleteSquidDBNFT(components, parcelTokenId, contractAddress),
        deleteSquidDBNFT(components, estateTokenId, contractAddress)
      ])
    })

    describe('when first parameter is set', () => {
      let response: Response
      let responseBody: NFTsResponse

      beforeEach(async () => {
        await createWearableNFT(components, contractAddress, wearableTokenId)
        await createParcelNFT(components, contractAddress, parcelTokenId)
        await createEstateNFT(components, contractAddress, estateTokenId)

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?first=2')
        responseBody = await response.json()
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should limit results to specified amount', async () => {
        expect(responseBody.data.length).toBe(2)
      })
    })

    describe('when skip parameter is set', () => {
      let allResponse: Response
      let allBody: NFTsResponse
      let skippedResponse: Response
      let skippedBody: NFTsResponse
      let firstItemId: string
      let secondItemId: string
      let thirdItemId: string

      beforeEach(async () => {
        await createWearableNFT(components, contractAddress, wearableTokenId)
        await createParcelNFT(components, contractAddress, parcelTokenId)
        await createEstateNFT(components, contractAddress, estateTokenId)

        const { localFetch } = components
        allResponse = await localFetch.fetch(`/v1/nfts?sortBy=newest&contractAddress=${contractAddress}`)
        allBody = await allResponse.json()
        firstItemId = allBody.data[0].nft.tokenId
        secondItemId = allBody.data[1].nft.tokenId
        thirdItemId = allBody.data[2].nft.tokenId

        skippedResponse = await localFetch.fetch(`/v1/nfts?skip=1&first=2&sortBy=newest&contractAddress=${contractAddress}`)
        skippedBody = await skippedResponse.json()
      })

      it('should respond with 200 status', async () => {
        expect(skippedResponse.status).toEqual(200)
      })

      it('should return correct number of items after skip', async () => {
        expect(skippedBody.data.length).toBe(2)
      })

      it('should skip first item and return next items in order', async () => {
        const allIds = allBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        const skippedIds = skippedBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        
        // The first item should not be in the skipped results
        expect(skippedIds).not.toContain(allIds[0])
        
        // All returned items should be from the original list
        skippedIds.forEach(id => {
          expect(allIds).toContain(id)
        })
      })
    })

    describe('when skip parameter is very large', () => {
      let response: Response
      let responseBody: NFTsResponse

      beforeEach(async () => {
        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?first=10000&skip=5000')
        responseBody = await response.json()
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should respond with empty data array', async () => {
        expect(responseBody.data).toEqual([])
      })
    })
  })

  describe('and sorting NFTs', () => {
    afterEach(async () => {
      await Promise.all([
        deleteSquidDBNFT(components, wearableTokenId, contractAddress),
        deleteSquidDBNFT(components, parcelTokenId, contractAddress),
        deleteSquidDBNFT(components, estateTokenId, contractAddress)
      ])
    })

    describe('when sortBy is newest', () => {
      let response: Response
      let responseBody: NFTsResponse

      beforeEach(async () => {
        await createWearableNFT(components, contractAddress, wearableTokenId)
        await createParcelNFT(components, contractAddress, parcelTokenId)
        await createEstateNFT(components, contractAddress, estateTokenId)

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?sortBy=newest')
        responseBody = await response.json()
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should sort NFTs by creation date descending', async () => {
        for (let i = 0; i < responseBody.data.length - 1; i++) {
          const currentCreatedAt = responseBody.data[i].nft.createdAt
          const nextCreatedAt = responseBody.data[i + 1].nft.createdAt
          expect(currentCreatedAt).toBeGreaterThanOrEqual(nextCreatedAt)
        }
      })
    })

    describe('when sortBy is oldest', () => {
      let response: Response
      let responseBody: NFTsResponse

      beforeEach(async () => {
        await createWearableNFT(components, contractAddress, wearableTokenId)
        await createParcelNFT(components, contractAddress, parcelTokenId)
        await createEstateNFT(components, contractAddress, estateTokenId)

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?sortBy=oldest')
        responseBody = await response.json()
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should sort NFTs by creation date ascending', async () => {
        // Filter only the NFTs created in this test
        const createdNFTIds = [wearableTokenId, parcelTokenId, estateTokenId]
        const testNFTs = responseBody.data.filter((nftResponse: NFTResponse) => 
          createdNFTIds.includes(nftResponse.nft.tokenId)
        )
        
        for (let i = 0; i < testNFTs.length - 1; i++) {
          const currentCreatedAt = testNFTs[i].nft.createdAt
          const nextCreatedAt = testNFTs[i + 1].nft.createdAt
          expect(currentCreatedAt).toBeLessThanOrEqual(nextCreatedAt)
        }
      })
    })
  })

  describe('and filtering by network', () => {
    afterEach(async () => {
      await Promise.all([
        deleteSquidDBNFT(components, wearableTokenId, contractAddress),
        deleteSquidDBNFT(components, parcelTokenId, contractAddress)
      ])
    })

    describe('when network filter is ETHEREUM', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]

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

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?network=ETHEREUM')
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include NFTs from ETHEREUM network', async () => {
        expect(returnedIds).toContain(wearableTokenId)
      })

      it('should not include NFTs from other networks', async () => {
        expect(returnedIds).not.toContain(parcelTokenId)
      })
    })
  })

  describe('and filtering by rarity', () => {
    afterEach(async () => {
      await deleteSquidDBNFT(components, wearableTokenId, contractAddress)
    })

    describe('when rarity filter is common', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]

      beforeEach(async () => {
        await createSquidDBNFT(components, {
          tokenId: wearableTokenId,
          contractAddress,
          category: NFTCategory.WEARABLE,
          rarity: Rarity.COMMON
        })

        const { localFetch } = components
        response = await localFetch.fetch('/v1/nfts?rarity=common')
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include NFTs of specified rarity', async () => {
        expect(returnedIds).toContain(wearableTokenId)
      })
    })
  })

  describe('and combining multiple filters', () => {
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

    describe('when filtering by isOnSale and owner', () => {
      const ownerAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]
      let owners: string[]

      beforeEach(async () => {
        await createNFTOnSale(components, contractAddress, onSaleTokenId, '100000000000000000000', ownerAddress)
        await createNFTNotForSale(components, contractAddress, notForSaleTokenId, ownerAddress)
        await createNFTOnSale(components, contractAddress, cheapTokenId, '50000000000000000000')

        const { localFetch } = components
        response = await localFetch.fetch(`/v1/nfts?isOnSale=true&owner=${ownerAddress}`)
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        owners = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.owner)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include NFTs on sale from specified owner', async () => {
        expect(returnedIds).toContain(onSaleTokenId)
      })

      it('should not include NFTs not for sale', async () => {
        expect(returnedIds).not.toContain(notForSaleTokenId)
      })

      it('should not include NFTs from different owner', async () => {
        expect(returnedIds).not.toContain(cheapTokenId)
      })

      it('should only return NFTs from specified owner', async () => {
        owners.forEach((owner: string) => {
          expect(owner.toLowerCase()).toBe(ownerAddress.toLowerCase())
        })
      })
    })

    describe('when filtering by category and contractAddress', () => {
      let response: Response
      let responseBody: NFTsResponse
      let returnedIds: string[]
      let categories: string[]
      let contracts: string[]

      beforeEach(async () => {
        await createWearableNFT(components, contractAddress, wearableTokenId)
        await createParcelNFT(components, contractAddress, parcelTokenId)
        await createWearableNFT(components, secondContractAddress, secondContractTokenId)

        const { localFetch } = components
        response = await localFetch.fetch(`/v1/nfts?category=wearable&contractAddress=${contractAddress}`)
        responseBody = await response.json()
        returnedIds = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.tokenId)
        categories = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.category)
        contracts = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.contractAddress)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include wearables from specified contract', async () => {
        expect(returnedIds).toContain(wearableTokenId)
      })

      it('should not include other categories', async () => {
        expect(returnedIds).not.toContain(parcelTokenId)
      })

      it('should not include NFTs from other contracts', async () => {
        expect(returnedIds).not.toContain(secondContractTokenId)
      })

      it('should only return wearable category', async () => {
        categories.forEach((category: string) => {
          expect(category).toBe('wearable')
        })
      })

      it('should only return specified contract address', async () => {
        contracts.forEach((contract: string) => {
          expect(contract).toBe(contractAddress)
        })
      })
    })

    describe('when filtering with pagination', () => {
      const ownerAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
      let response: Response
      let responseBody: NFTsResponse
      let owners: string[]

      beforeEach(async () => {
        await createNFTOnSale(components, contractAddress, onSaleTokenId, '100000000000000000000', ownerAddress)
        await createNFTNotForSale(components, contractAddress, notForSaleTokenId, ownerAddress)

        const { localFetch } = components
        response = await localFetch.fetch(`/v1/nfts?owner=${ownerAddress}&first=2`)
        responseBody = await response.json()
        owners = responseBody.data.map((nftResponse: NFTResponse) => nftResponse.nft.owner)
      })

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should limit results to specified amount', async () => {
        expect(responseBody.data.length).toBeLessThanOrEqual(2)
      })

      it('should only return NFTs from specified owner', async () => {
        owners.forEach((owner: string) => {
          expect(owner.toLowerCase()).toBe(ownerAddress.toLowerCase())
        })
      })
    })
  })

  describe('and handling invalid query parameters', () => {
    describe('when both owner and tenant parameters are provided', () => {
      const ownerAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
      const tenantAddress = '0x1234567890123456789012345678901234567890'
      let response: Response

      beforeEach(async () => {
        const { localFetch } = components
        response = await localFetch.fetch(`/v1/nfts?owner=${ownerAddress}&tenant=${tenantAddress}`)
      })

      it('should respond with 400 status', async () => {
        expect(response.status).toEqual(400)
      })
    })
  })
})
