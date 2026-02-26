import { Response } from 'node-fetch'
import { Item } from '@dcl/schemas'
import { test } from '../components'
import {
  createItemOnlyMintingOld,
  createItemOnlyListingOld,
  createItemNotForSale,
  createItemMintingAndListing,
  createItemNotApproved,
  deleteSquidDBItem
} from './utils/dbItems'

test('when fetching items from the catalog', function ({ components }) {
  const contractAddress = '0xcf898476136602cd9d61e65945b5ecf9128ff339'
  const secondContractAddress = '0x1234567890123456789012345678901234567890'

  // Item IDs for different test scenarios
  const mintingItemId = '1001'
  const listingItemId = '1002'
  const notForSaleItemId = '1003'
  const hybridItemId = '1004'
  const notApprovedItemId = '1005'
  const expensiveItemId = '1006'
  const cheapItemId = '1007'
  const secondContractItemId = '2001'

  afterEach(async () => {
    // Clean up all test items
    await Promise.all([
      deleteSquidDBItem(components, mintingItemId, contractAddress),
      deleteSquidDBItem(components, listingItemId, contractAddress),
      deleteSquidDBItem(components, notForSaleItemId, contractAddress),
      deleteSquidDBItem(components, hybridItemId, contractAddress),
      deleteSquidDBItem(components, notApprovedItemId, contractAddress),
      deleteSquidDBItem(components, expensiveItemId, contractAddress),
      deleteSquidDBItem(components, cheapItemId, contractAddress),
      deleteSquidDBItem(components, secondContractItemId, secondContractAddress)
    ])
  })

  describe('when using the v1 API', () => {
    describe('and validating response structure', () => {
      let response: Response
      let responseBody: any

      beforeEach(async () => {
        await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
        const { localFetch } = components
        response = await localFetch.fetch('/v1/catalog')
        responseBody = await response.json()
      })

      it('should respond with 200 and valid catalog response with correct item structure', async () => {
        expect(response.status).toEqual(200)
        expect(responseBody).toHaveProperty('data')
        expect(Array.isArray(responseBody.data)).toBe(true)
        expect(responseBody).toHaveProperty('total')
        expect(typeof responseBody.total).toBe('number')
        expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
        expect(responseBody.data.length).toBeGreaterThan(0)

        const item = responseBody.data[0]
        expect(item).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            itemId: expect.any(String),
            contractAddress: expect.any(String),
            category: expect.any(String),
            rarity: expect.any(String),
            isOnSale: expect.any(Boolean),
            price: expect.any(String)
          })
        )
      })
    })

    describe('and filtering by item state', () => {
      describe('when onlyMinting filter is true', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)

          const { localFetch } = components
          response = await localFetch.fetch('/v1/catalog?onlyMinting=true')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and only minting items', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(mintingItemId)
          expect(returnedIds).not.toContain(listingItemId)
          expect(returnedIds).not.toContain(notForSaleItemId)
        })
      })

      describe('when onlyListing filter is true', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)

          const { localFetch } = components
          response = await localFetch.fetch('/v1/catalog?onlyListing=true')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and only listing items', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(listingItemId)
          expect(returnedIds).not.toContain(mintingItemId)
          expect(returnedIds).not.toContain(notForSaleItemId)
        })
      })

      describe('when isOnSale filter is true', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)
          await createItemMintingAndListing(components, contractAddress, hybridItemId, '200000000000000000000', '75000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch('/v1/catalog?isOnSale=true')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and only items on sale', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(mintingItemId)
          expect(returnedIds).toContain(listingItemId)
          expect(returnedIds).toContain(hybridItemId)
          expect(returnedIds).not.toContain(notForSaleItemId)
        })
      })

      describe('when isOnSale filter is false', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)
          await createItemMintingAndListing(components, contractAddress, hybridItemId, '200000000000000000000', '75000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch('/v1/catalog?isOnSale=false')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and only items not on sale', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(notForSaleItemId)
          expect(returnedIds).not.toContain(mintingItemId)
          expect(returnedIds).not.toContain(listingItemId)
          expect(returnedIds).not.toContain(hybridItemId)
        })
      })

      describe('when onlyMinting and onlyListing are both true', () => {
        let response: Response
        let responseBody: any

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch('/v1/catalog?onlyMinting=true&onlyListing=true')
          responseBody = await response.json()
        })

        it('should respond with 200 and empty data since the filters are contradictory', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.data).toEqual([])
          expect(responseBody.total).toBe(0)
        })
      })
    })

    describe('and filtering by collection approval', () => {
      let response: Response
      let responseBody: any
      let returnedIds: string[]

      beforeEach(async () => {
        await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
        await createItemNotApproved(components, contractAddress, notApprovedItemId)

        const { localFetch } = components
        response = await localFetch.fetch('/v1/catalog')
        responseBody = await response.json()
        returnedIds = responseBody.data.map((item: Item) => item.itemId)
      })

      it('should respond with 200 and only approved collection items', async () => {
        expect(response.status).toEqual(200)
        expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
        expect(returnedIds).toContain(mintingItemId)
        expect(returnedIds).not.toContain(notApprovedItemId)
      })
    })

    describe('and filtering by price', () => {
      describe('when minPrice filter is set', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, cheapItemId, '10000000000000000000') // 10 MANA
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000') // 100 MANA
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000') // 50 MANA
          await createItemOnlyMintingOld(components, contractAddress, expensiveItemId, '1000000000000000000000') // 1000 MANA

          const { localFetch } = components
          response = await localFetch.fetch('/v1/catalog?minPrice=100') // 100 MANA minimum
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and only items at or above minimum price', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(mintingItemId) // 100 MANA
          expect(returnedIds).toContain(expensiveItemId) // 1000 MANA
          expect(returnedIds).not.toContain(cheapItemId) // 10 MANA
          expect(returnedIds).not.toContain(listingItemId) // 50 MANA
        })
      })

      describe('when maxPrice filter is set', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, cheapItemId, '10000000000000000000') // 10 MANA
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000') // 100 MANA
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000') // 50 MANA
          await createItemOnlyMintingOld(components, contractAddress, expensiveItemId, '1000000000000000000000') // 1000 MANA

          const { localFetch } = components
          response = await localFetch.fetch('/v1/catalog?maxPrice=100') // 100 MANA maximum
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and only items at or below maximum price', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(cheapItemId) // 10 MANA
          expect(returnedIds).toContain(listingItemId) // 50 MANA
          expect(returnedIds).toContain(mintingItemId) // 100 MANA
          expect(returnedIds).not.toContain(expensiveItemId) // 1000 MANA
        })
      })

      describe('when both minPrice and maxPrice filters are set', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, cheapItemId, '10000000000000000000') // 10 MANA
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000') // 100 MANA
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000') // 50 MANA
          await createItemOnlyMintingOld(components, contractAddress, expensiveItemId, '1000000000000000000000') // 1000 MANA

          const { localFetch } = components
          response = await localFetch.fetch('/v1/catalog?minPrice=50&maxPrice=150') // 50-150 MANA
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and only items within price range', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(listingItemId) // 50 MANA
          expect(returnedIds).toContain(mintingItemId) // 100 MANA
          expect(returnedIds).not.toContain(cheapItemId) // 10 MANA
          expect(returnedIds).not.toContain(expensiveItemId) // 1000 MANA
        })
      })

      describe('when price parameters are invalid', () => {
        let response: Response

        beforeEach(async () => {
          const { localFetch } = components
          response = await localFetch.fetch('/v1/catalog?minPrice=invalid&maxPrice=also_invalid')
        })

        it('should respond with 400 status for invalid price parameters', async () => {
          expect(response.status).toEqual(400)
        })
      })
    })

    describe('and filtering by contract address', () => {
      describe('when filtering by a single contract address', () => {
        let response: Response
        let responseBody: any
        let returnedContractAddresses: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyMintingOld(components, secondContractAddress, secondContractItemId, '100000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch(`/v1/catalog?contractAddress=${contractAddress}`)
          responseBody = await response.json()
          returnedContractAddresses = responseBody.data.map((item: Item) => item.contractAddress)
        })

        it('should respond with 200 and only items from specified contract', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          returnedContractAddresses.forEach((addr: string) => {
            expect(addr).toBe(contractAddress)
          })
        })
      })

      describe('when filtering by multiple contract addresses', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyMintingOld(components, secondContractAddress, secondContractItemId, '100000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch(`/v1/catalog?contractAddress=${contractAddress}&contractAddress=${secondContractAddress}`)
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and items from all specified contracts', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(mintingItemId)
          expect(returnedIds).toContain(secondContractItemId)
        })
      })

      describe('when contract address does not exist', () => {
        let response: Response
        let responseBody: any

        beforeEach(async () => {
          const { localFetch } = components
          const nonExistentAddress = '0x0000000000000000000000000000000000000000'
          response = await localFetch.fetch(`/v1/catalog?contractAddress=${nonExistentAddress}`)
          responseBody = await response.json()
        })

        it('should respond with 200 and empty data with zero total', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.data).toEqual([])
          expect(responseBody.total).toBe(0)
        })
      })
    })

    describe('and using pagination', () => {
      describe('when first parameter is set', () => {
        let response: Response
        let responseBody: any

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, cheapItemId, '10000000000000000000')
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyMintingOld(components, contractAddress, expensiveItemId, '1000000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch('/v1/catalog?first=1')
          responseBody = await response.json()
        })

        it('should respond with 200 and limited results with correct total', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.data.length).toBe(1)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
        })
      })

      describe('when skip parameter is set', () => {
        let allResponse: Response
        let allBody: any
        let skippedResponse: Response
        let skippedBody: any

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, cheapItemId, '10000000000000000000')
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyMintingOld(components, contractAddress, expensiveItemId, '1000000000000000000000')

          const { localFetch } = components
          allResponse = await localFetch.fetch('/v1/catalog')
          allBody = await allResponse.json()
          skippedResponse = await localFetch.fetch('/v1/catalog?skip=1')
          skippedBody = await skippedResponse.json()
        })

        it('should respond with 200 and correct number of items after skip', async () => {
          expect(skippedResponse.status).toEqual(200)
          expect(skippedBody.data.length).toBe(allBody.total - 1)
          expect(skippedBody.total).toBeGreaterThanOrEqual(skippedBody.data.length)
        })
      })

      describe('when skip parameter is very large', () => {
        let response: Response
        let responseBody: any

        beforeEach(async () => {
          const { localFetch } = components
          response = await localFetch.fetch('/v1/catalog?skip=1000000&first=1000')
          responseBody = await response.json()
        })

        it('should respond with 200 and empty data', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.data).toEqual([])
        })
      })
    })

    describe('and sorting items', () => {
      describe('when sortBy is cheapest', () => {
        let response: Response
        let responseBody: any

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, cheapItemId, '10000000000000000000')
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyMintingOld(components, contractAddress, expensiveItemId, '1000000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch('/v1/catalog?sortBy=cheapest')
          responseBody = await response.json()
        })

        it('should respond with 200 and items sorted by price ascending', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          for (let i = 0; i < responseBody.data.length - 1; i++) {
            const currentPrice = parseFloat(responseBody.data[i].price || '0')
            const nextPrice = parseFloat(responseBody.data[i + 1].price || '0')
            expect(currentPrice).toBeLessThanOrEqual(nextPrice)
          }
        })
      })

      describe('when sortBy is most_expensive', () => {
        let response: Response
        let responseBody: any

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, cheapItemId, '10000000000000000000')
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyMintingOld(components, contractAddress, expensiveItemId, '1000000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch('/v1/catalog?sortBy=most_expensive')
          responseBody = await response.json()
        })

        it('should respond with 200 and items sorted by price descending', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          for (let i = 0; i < responseBody.data.length - 1; i++) {
            const currentPrice = parseFloat(responseBody.data[i].price || '0')
            const nextPrice = parseFloat(responseBody.data[i + 1].price || '0')
            expect(currentPrice).toBeGreaterThanOrEqual(nextPrice)
          }
        })
      })
    })

    describe('and combining multiple filters', () => {
      describe('when filtering by onlyMinting and contractAddress', () => {
        let response: Response
        let responseBody: any
        let returnedAddresses: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)
          await createItemMintingAndListing(components, contractAddress, hybridItemId, '200000000000000000000', '75000000000000000000')
          await createItemOnlyMintingOld(components, secondContractAddress, secondContractItemId, '80000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch(`/v1/catalog?onlyMinting=true&contractAddress=${contractAddress}`)
          responseBody = await response.json()
          returnedAddresses = responseBody.data.map((item: Item) => item.contractAddress)
        })

        it('should respond with 200 and only minting items from specified contract', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          returnedAddresses.forEach((addr: string) => {
            expect(addr).toBe(contractAddress)
          })
          const returnedIds = responseBody.data.map((item: Item) => item.itemId)
          expect(returnedIds).toContain(mintingItemId)
          expect(returnedIds).toContain(hybridItemId)
          expect(returnedIds).not.toContain(listingItemId)
          expect(returnedIds).not.toContain(notForSaleItemId)
          expect(returnedIds).not.toContain(secondContractItemId)
        })
      })

      describe('when filtering by isOnSale and price range', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)

          const { localFetch } = components
          response = await localFetch.fetch('/v1/catalog?isOnSale=true&minPrice=60&maxPrice=150')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and only items on sale within price range', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(mintingItemId) // 100 MANA, on sale
          expect(returnedIds).not.toContain(listingItemId) // 50 MANA, below min
          expect(returnedIds).not.toContain(notForSaleItemId)
        })
      })

      describe('when filtering with pagination', () => {
        let response: Response
        let responseBody: any
        let returnedAddresses: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)
          await createItemMintingAndListing(components, contractAddress, hybridItemId, '200000000000000000000', '75000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch(`/v1/catalog?contractAddress=${contractAddress}&first=2`)
          responseBody = await response.json()
          returnedAddresses = responseBody.data.map((item: Item) => item.contractAddress)
        })

        it('should respond with 200, limited results, and correct total', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.data.length).toBeLessThanOrEqual(2)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          returnedAddresses.forEach((addr: string) => {
            expect(addr).toBe(contractAddress)
          })
        })
      })
    })
  })

  describe('when using the v2 API', () => {
    describe('and validating response structure', () => {
      let response: Response
      let responseBody: any

      beforeEach(async () => {
        await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
        const { localFetch } = components
        response = await localFetch.fetch('/v2/catalog')
        responseBody = await response.json()
      })

      it('should respond with 200 and valid catalog response with correct item structure', async () => {
        expect(response.status).toEqual(200)
        expect(responseBody).toHaveProperty('data')
        expect(Array.isArray(responseBody.data)).toBe(true)
        expect(responseBody).toHaveProperty('total')
        expect(typeof responseBody.total).toBe('number')
        expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
      })
    })

    describe('and filtering by item state', () => {
      describe('when onlyMinting filter is true', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)

          const { localFetch } = components
          response = await localFetch.fetch('/v2/catalog?onlyMinting=true')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and only minting items', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(mintingItemId)
          expect(returnedIds).not.toContain(listingItemId)
          expect(returnedIds).not.toContain(notForSaleItemId)
        })
      })

      describe('when onlyListing filter is true', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)

          const { localFetch } = components
          response = await localFetch.fetch('/v2/catalog?onlyListing=true')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and only listing items', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(listingItemId)
          expect(returnedIds).not.toContain(mintingItemId)
          expect(returnedIds).not.toContain(notForSaleItemId)
        })
      })

      describe('when isOnSale filter is true', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)
          await createItemMintingAndListing(components, contractAddress, hybridItemId, '200000000000000000000', '75000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch('/v2/catalog?isOnSale=true')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and only items on sale', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(mintingItemId)
          expect(returnedIds).toContain(listingItemId)
          expect(returnedIds).toContain(hybridItemId)
          expect(returnedIds).not.toContain(notForSaleItemId)
        })
      })

      describe('when isOnSale filter is false', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)

          const { localFetch } = components
          response = await localFetch.fetch('/v2/catalog?isOnSale=false')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and only items not on sale', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(notForSaleItemId)
          expect(returnedIds).not.toContain(mintingItemId)
        })
      })
    })

    describe('and filtering by collection approval', () => {
      let response: Response
      let responseBody: any
      let returnedIds: string[]

      beforeEach(async () => {
        await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
        await createItemNotApproved(components, contractAddress, notApprovedItemId)

        const { localFetch } = components
        response = await localFetch.fetch('/v2/catalog')
        responseBody = await response.json()
        returnedIds = responseBody.data.map((item: Item) => item.itemId)
      })

      it('should respond with 200 and only approved collection items', async () => {
        expect(response.status).toEqual(200)
        expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
        expect(returnedIds).not.toContain(notApprovedItemId)
      })
    })

    describe('and filtering by price', () => {
      describe('when minPrice filter is set', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, cheapItemId, '10000000000000000000') // 10 MANA
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000') // 100 MANA
          await createItemOnlyMintingOld(components, contractAddress, expensiveItemId, '1000000000000000000000') // 1000 MANA

          const { localFetch } = components
          response = await localFetch.fetch('/v2/catalog?minPrice=100')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and only items at or above minimum price', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(mintingItemId)
          expect(returnedIds).toContain(expensiveItemId)
          expect(returnedIds).not.toContain(cheapItemId)
        })
      })

      describe('when maxPrice filter is set', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, cheapItemId, '10000000000000000000') // 10 MANA
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000') // 100 MANA
          await createItemOnlyMintingOld(components, contractAddress, expensiveItemId, '1000000000000000000000') // 1000 MANA

          const { localFetch } = components
          response = await localFetch.fetch('/v2/catalog?maxPrice=100')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and only items at or below maximum price', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(cheapItemId)
          expect(returnedIds).toContain(mintingItemId)
          expect(returnedIds).not.toContain(expensiveItemId)
        })
      })

      describe('when both minPrice and maxPrice filters are set', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, cheapItemId, '10000000000000000000') // 10 MANA
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000') // 100 MANA
          await createItemOnlyMintingOld(components, contractAddress, expensiveItemId, '1000000000000000000000') // 1000 MANA

          const { localFetch } = components
          response = await localFetch.fetch('/v2/catalog?minPrice=50&maxPrice=500')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and only items within price range', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(mintingItemId) // 100 MANA
          expect(returnedIds).not.toContain(cheapItemId) // 10 MANA
          expect(returnedIds).not.toContain(expensiveItemId) // 1000 MANA
        })
      })
    })

    describe('and filtering by contract address', () => {
      describe('when filtering by a single contract address', () => {
        let response: Response
        let responseBody: any
        let returnedContractAddresses: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyMintingOld(components, secondContractAddress, secondContractItemId, '100000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch(`/v2/catalog?contractAddress=${contractAddress}`)
          responseBody = await response.json()
          returnedContractAddresses = responseBody.data.map((item: Item) => item.contractAddress)
        })

        it('should respond with 200 and only items from specified contract', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          returnedContractAddresses.forEach((addr: string) => {
            expect(addr).toBe(contractAddress)
          })
        })
      })
    })

    describe('and using pagination', () => {
      describe('when first parameter is set', () => {
        let response: Response
        let responseBody: any

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, cheapItemId, '10000000000000000000')
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyMintingOld(components, contractAddress, expensiveItemId, '1000000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch('/v2/catalog?first=1')
          responseBody = await response.json()
        })

        it('should respond with 200 and limited results with correct total', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.data.length).toBe(1)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
        })
      })

      describe('when skip parameter is set', () => {
        let allResponse: Response
        let allBody: any
        let skippedResponse: Response
        let skippedBody: any

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, cheapItemId, '10000000000000000000')
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyMintingOld(components, contractAddress, expensiveItemId, '1000000000000000000000')

          const { localFetch } = components
          allResponse = await localFetch.fetch('/v2/catalog')
          allBody = await allResponse.json()
          skippedResponse = await localFetch.fetch('/v2/catalog?skip=1')
          skippedBody = await skippedResponse.json()
        })

        it('should respond with 200 and correct number of items after skip', async () => {
          expect(skippedResponse.status).toEqual(200)
          expect(skippedBody.data.length).toBe(allBody.total - 1)
          expect(skippedBody.total).toBeGreaterThanOrEqual(skippedBody.data.length)
        })
      })
    })

    describe('and sorting items', () => {
      describe('when sortBy is cheapest', () => {
        let response: Response
        let responseBody: any

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, cheapItemId, '10000000000000000000')
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyMintingOld(components, contractAddress, expensiveItemId, '1000000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch('/v2/catalog?sortBy=cheapest')
          responseBody = await response.json()
        })

        it('should respond with 200 and items sorted by price ascending', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          for (let i = 0; i < responseBody.data.length - 1; i++) {
            const currentPrice = parseFloat(responseBody.data[i].price || '0')
            const nextPrice = parseFloat(responseBody.data[i + 1].price || '0')
            expect(currentPrice).toBeLessThanOrEqual(nextPrice)
          }
        })
      })

      describe('when sortBy is most_expensive', () => {
        let response: Response
        let responseBody: any

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, cheapItemId, '10000000000000000000')
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyMintingOld(components, contractAddress, expensiveItemId, '1000000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch('/v2/catalog?sortBy=most_expensive')
          responseBody = await response.json()
        })

        it('should respond with 200 and items sorted by price descending', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          for (let i = 0; i < responseBody.data.length - 1; i++) {
            const currentPrice = parseFloat(responseBody.data[i].price || '0')
            const nextPrice = parseFloat(responseBody.data[i + 1].price || '0')
            expect(currentPrice).toBeGreaterThanOrEqual(nextPrice)
          }
        })
      })
    })

    describe('and combining multiple filters', () => {
      describe('when filtering by onlyMinting and contractAddress', () => {
        let response: Response
        let responseBody: any
        let returnedAddresses: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)
          await createItemOnlyMintingOld(components, secondContractAddress, secondContractItemId, '80000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch(`/v2/catalog?onlyMinting=true&contractAddress=${contractAddress}`)
          responseBody = await response.json()
          returnedAddresses = responseBody.data.map((item: Item) => item.contractAddress)
        })

        it('should respond with 200 and only minting items from specified contract', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          returnedAddresses.forEach((addr: string) => {
            expect(addr).toBe(contractAddress)
          })
          const returnedIds = responseBody.data.map((item: Item) => item.itemId)
          expect(returnedIds).toContain(mintingItemId)
          expect(returnedIds).not.toContain(listingItemId)
          expect(returnedIds).not.toContain(notForSaleItemId)
          expect(returnedIds).not.toContain(secondContractItemId)
        })
      })

      describe('when filtering by isOnSale and price range', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)

          const { localFetch } = components
          response = await localFetch.fetch('/v2/catalog?isOnSale=true&minPrice=60&maxPrice=150')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 and only items on sale within price range', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          expect(returnedIds).toContain(mintingItemId) // 100 MANA, on sale
          expect(returnedIds).not.toContain(listingItemId) // 50 MANA, below min
          expect(returnedIds).not.toContain(notForSaleItemId)
        })
      })

      describe('when filtering with pagination', () => {
        let response: Response
        let responseBody: any
        let returnedAddresses: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)

          const { localFetch } = components
          response = await localFetch.fetch(`/v2/catalog?contractAddress=${contractAddress}&first=2`)
          responseBody = await response.json()
          returnedAddresses = responseBody.data.map((item: Item) => item.contractAddress)
        })

        it('should respond with 200, limited results, and correct total', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.data.length).toBeLessThanOrEqual(2)
          expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
          returnedAddresses.forEach((addr: string) => {
            expect(addr).toBe(contractAddress)
          })
        })
      })
    })

    describe('and verifying total matches data count with onlyMinting and price filters', () => {
      let mintingContract: string
      let cheapMintingItemId: string
      let midMintingItemId: string
      let expensiveMintingItemId: string

      beforeEach(() => {
        mintingContract = '0xaaaa000000000000000000000000000000000001'
        cheapMintingItemId = '3001'
        midMintingItemId = '3002'
        expensiveMintingItemId = '3003'
      })

      afterEach(async () => {
        await Promise.all([
          deleteSquidDBItem(components, cheapMintingItemId, mintingContract),
          deleteSquidDBItem(components, midMintingItemId, mintingContract),
          deleteSquidDBItem(components, expensiveMintingItemId, mintingContract)
        ])
      })

      describe('when onlyMinting is true and minPrice is set', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, mintingContract, cheapMintingItemId, '10000000000000000000') // 10 MANA
          await createItemOnlyMintingOld(components, mintingContract, midMintingItemId, '100000000000000000000') // 100 MANA
          await createItemOnlyMintingOld(components, mintingContract, expensiveMintingItemId, '1000000000000000000000') // 1000 MANA

          const { localFetch } = components
          response = await localFetch.fetch(`/v2/catalog?onlyMinting=true&minPrice=50&contractAddress=${mintingContract}`)
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should have total equal to data length', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBe(responseBody.data.length)
        })

        it('should only return items at or above the minimum price', async () => {
          expect(returnedIds).toContain(midMintingItemId)
          expect(returnedIds).toContain(expensiveMintingItemId)
          expect(returnedIds).not.toContain(cheapMintingItemId)
        })
      })

      describe('when onlyMinting is true and maxPrice is set', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, mintingContract, cheapMintingItemId, '10000000000000000000') // 10 MANA
          await createItemOnlyMintingOld(components, mintingContract, midMintingItemId, '100000000000000000000') // 100 MANA
          await createItemOnlyMintingOld(components, mintingContract, expensiveMintingItemId, '1000000000000000000000') // 1000 MANA

          const { localFetch } = components
          response = await localFetch.fetch(`/v2/catalog?onlyMinting=true&maxPrice=500&contractAddress=${mintingContract}`)
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should have total equal to data length', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBe(responseBody.data.length)
        })

        it('should only return items at or below the maximum price', async () => {
          expect(returnedIds).toContain(cheapMintingItemId)
          expect(returnedIds).toContain(midMintingItemId)
          expect(returnedIds).not.toContain(expensiveMintingItemId)
        })
      })

      describe('when onlyMinting is true and both minPrice and maxPrice are set', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, mintingContract, cheapMintingItemId, '10000000000000000000') // 10 MANA
          await createItemOnlyMintingOld(components, mintingContract, midMintingItemId, '100000000000000000000') // 100 MANA
          await createItemOnlyMintingOld(components, mintingContract, expensiveMintingItemId, '1000000000000000000000') // 1000 MANA

          const { localFetch } = components
          response = await localFetch.fetch(`/v2/catalog?onlyMinting=true&minPrice=50&maxPrice=500&contractAddress=${mintingContract}`)
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should have total equal to data length', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBe(responseBody.data.length)
        })

        it('should only return items within the price range', async () => {
          expect(returnedIds).toContain(midMintingItemId)
          expect(returnedIds).not.toContain(cheapMintingItemId)
          expect(returnedIds).not.toContain(expensiveMintingItemId)
        })
      })

      describe('when onlyMinting is true and isOnSale is true with minPrice', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, mintingContract, cheapMintingItemId, '10000000000000000000') // 10 MANA
          await createItemOnlyMintingOld(components, mintingContract, midMintingItemId, '100000000000000000000') // 100 MANA
          await createItemOnlyMintingOld(components, mintingContract, expensiveMintingItemId, '1000000000000000000000') // 1000 MANA

          const { localFetch } = components
          response = await localFetch.fetch(`/v2/catalog?onlyMinting=true&isOnSale=true&minPrice=1&contractAddress=${mintingContract}`)
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should have total equal to data length', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBe(responseBody.data.length)
        })

        it('should return all minting items above minimum price', async () => {
          expect(returnedIds).toContain(cheapMintingItemId)
          expect(returnedIds).toContain(midMintingItemId)
          expect(returnedIds).toContain(expensiveMintingItemId)
        })
      })
    })

    describe('and verifying total matches data count with onlyListing and price filters', () => {
      let listingContract: string
      let cheapListingItemId: string
      let midListingItemId: string
      let expensiveListingItemId: string

      beforeEach(() => {
        listingContract = '0xbbbb000000000000000000000000000000000001'
        cheapListingItemId = '4001'
        midListingItemId = '4002'
        expensiveListingItemId = '4003'
      })

      afterEach(async () => {
        await Promise.all([
          deleteSquidDBItem(components, cheapListingItemId, listingContract),
          deleteSquidDBItem(components, midListingItemId, listingContract),
          deleteSquidDBItem(components, expensiveListingItemId, listingContract)
        ])
      })

      describe('when onlyListing is true and minPrice is set', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyListingOld(components, listingContract, cheapListingItemId, '10000000000000000000') // 10 MANA
          await createItemOnlyListingOld(components, listingContract, midListingItemId, '100000000000000000000') // 100 MANA
          await createItemOnlyListingOld(components, listingContract, expensiveListingItemId, '1000000000000000000000') // 1000 MANA

          const { localFetch } = components
          response = await localFetch.fetch(`/v2/catalog?onlyListing=true&minPrice=50&contractAddress=${listingContract}`)
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should have total equal to data length', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBe(responseBody.data.length)
        })

        it('should only return listing items at or above the minimum price', async () => {
          expect(returnedIds).toContain(midListingItemId)
          expect(returnedIds).toContain(expensiveListingItemId)
          expect(returnedIds).not.toContain(cheapListingItemId)
        })
      })

      describe('when onlyListing is true and maxPrice is set', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyListingOld(components, listingContract, cheapListingItemId, '10000000000000000000') // 10 MANA
          await createItemOnlyListingOld(components, listingContract, midListingItemId, '100000000000000000000') // 100 MANA
          await createItemOnlyListingOld(components, listingContract, expensiveListingItemId, '1000000000000000000000') // 1000 MANA

          const { localFetch } = components
          response = await localFetch.fetch(`/v2/catalog?onlyListing=true&maxPrice=500&contractAddress=${listingContract}`)
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should have total equal to data length', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBe(responseBody.data.length)
        })

        it('should only return listing items at or below the maximum price', async () => {
          expect(returnedIds).toContain(cheapListingItemId)
          expect(returnedIds).toContain(midListingItemId)
          expect(returnedIds).not.toContain(expensiveListingItemId)
        })
      })

      describe('when onlyListing is true and both minPrice and maxPrice are set', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyListingOld(components, listingContract, cheapListingItemId, '10000000000000000000') // 10 MANA
          await createItemOnlyListingOld(components, listingContract, midListingItemId, '100000000000000000000') // 100 MANA
          await createItemOnlyListingOld(components, listingContract, expensiveListingItemId, '1000000000000000000000') // 1000 MANA

          const { localFetch } = components
          response = await localFetch.fetch(`/v2/catalog?onlyListing=true&minPrice=50&maxPrice=500&contractAddress=${listingContract}`)
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should have total equal to data length', async () => {
          expect(response.status).toEqual(200)
          expect(responseBody.total).toBe(responseBody.data.length)
        })

        it('should only return listing items within the price range', async () => {
          expect(returnedIds).toContain(midListingItemId)
          expect(returnedIds).not.toContain(cheapListingItemId)
          expect(returnedIds).not.toContain(expensiveListingItemId)
        })
      })
    })
  })
})
