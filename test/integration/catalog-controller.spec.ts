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

      it('should respond with at least one item with all required fields', async () => {
        expect(responseBody.data.length).toBeGreaterThan(0)
        const item = responseBody.data[0]
        expect(item).toHaveProperty('id')
        expect(item).toHaveProperty('itemId')
        expect(item).toHaveProperty('contractAddress')
        expect(item).toHaveProperty('category')
        expect(item).toHaveProperty('rarity')
        expect(item).toHaveProperty('isOnSale')
        expect(item).toHaveProperty('price')
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

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should include minting items', async () => {
          expect(returnedIds).toContain(mintingItemId)
        })

        it('should not include listing-only items', async () => {
          expect(returnedIds).not.toContain(listingItemId)
        })

        it('should not include items not for sale', async () => {
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

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should include listing items', async () => {
          expect(returnedIds).toContain(listingItemId)
        })

        it('should not include minting-only items', async () => {
          expect(returnedIds).not.toContain(mintingItemId)
        })

        it('should not include items not for sale', async () => {
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

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should include all items on sale', async () => {
          expect(returnedIds).toContain(mintingItemId)
          expect(returnedIds).toContain(listingItemId)
          expect(returnedIds).toContain(hybridItemId)
        })

        it('should not include items not for sale', async () => {
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

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should include items not for sale', async () => {
          expect(returnedIds).toContain(notForSaleItemId)
        })

        it('should not include items on sale', async () => {
          expect(returnedIds).not.toContain(mintingItemId)
          expect(returnedIds).not.toContain(listingItemId)
          expect(returnedIds).not.toContain(hybridItemId)
        })
      })

      describe('when onlyMinting and onlyListing are both true', () => {
        let response: Response

        beforeEach(async () => {
          const { localFetch } = components
          response = await localFetch.fetch('/v1/catalog?onlyMinting=true&onlyListing=true')
        })

        it('should respond with 400 status for conflicting filters', async () => {
          expect(response.status).toEqual(400)
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

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should include only approved collection items', async () => {
        expect(returnedIds).toContain(mintingItemId)
      })

      it('should not include non-approved collection items', async () => {
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

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should include items at or above minimum price', async () => {
          expect(returnedIds).toContain(mintingItemId) // 100 MANA
          expect(returnedIds).toContain(expensiveItemId) // 1000 MANA
        })

        it('should not include items below minimum price', async () => {
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

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should include items at or below maximum price', async () => {
          expect(returnedIds).toContain(cheapItemId) // 10 MANA
          expect(returnedIds).toContain(listingItemId) // 50 MANA
          expect(returnedIds).toContain(mintingItemId) // 100 MANA
        })

        it('should not include items above maximum price', async () => {
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

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should include items within price range', async () => {
          expect(returnedIds).toContain(listingItemId) // 50 MANA
          expect(returnedIds).toContain(mintingItemId) // 100 MANA
        })

        it('should not include items outside price range', async () => {
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

        it('should respond with 500 status', async () => {
          expect(response.status).toEqual(500)
        })
      })
    })

    describe('and filtering by contract address', () => {
      describe('when filtering by a single contract address', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]
        let returnedContractAddresses: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyMintingOld(components, secondContractAddress, secondContractItemId, '100000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch(`/v1/catalog?contractAddress=${contractAddress}`)
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
          returnedContractAddresses = responseBody.data.map((item: Item) => item.contractAddress)
        })

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should include items from the specified contract', async () => {
          expect(returnedIds).toContain(mintingItemId)
        })

        it('should not include items from other contracts', async () => {
          expect(returnedIds).not.toContain(secondContractItemId)
        })

        it('should only return items from the specified contract address', async () => {
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

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should include items from all specified contracts', async () => {
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

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should limit results to specified amount', async () => {
          expect(responseBody.data.length).toBe(1)
        })

        it('should respond with total greater than or equal to returned items', async () => {
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

        it('should respond with 200 status', async () => {
          expect(skippedResponse.status).toEqual(200)
        })

        it('should return correct number of items after skip', async () => {
          expect(skippedBody.data.length).toBe(allBody.total - 1)
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

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should respond with empty data array', async () => {
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

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should sort items by price ascending', async () => {
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

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should sort items by price descending', async () => {
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
        let returnedIds: string[]
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
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
          returnedAddresses = responseBody.data.map((item: Item) => item.contractAddress)
        })

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should include only minting items from specified contract', async () => {
          expect(returnedIds).toContain(mintingItemId)
          expect(returnedIds).toContain(hybridItemId)
        })

        it('should not include listing-only items', async () => {
          expect(returnedIds).not.toContain(listingItemId)
        })

        it('should not include items not for sale', async () => {
          expect(returnedIds).not.toContain(notForSaleItemId)
        })

        it('should not include items from other contracts', async () => {
          expect(returnedIds).not.toContain(secondContractItemId)
        })

        it('should only return items from specified contract address', async () => {
          returnedAddresses.forEach((addr: string) => {
            expect(addr).toBe(contractAddress)
          })
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

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should include items on sale within price range', async () => {
          expect(returnedIds).toContain(mintingItemId) // 100 MANA, on sale
        })

        it('should not include items below min price', async () => {
          expect(returnedIds).not.toContain(listingItemId) // 50 MANA
        })

        it('should not include items not for sale', async () => {
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

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should limit results to specified amount', async () => {
          expect(responseBody.data.length).toBeLessThanOrEqual(2)
        })

        it('should only return items from specified contract address', async () => {
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
    })

    describe('and filtering by item state', () => {
      describe('when onlyMinting filter is true', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch('/v2/catalog?onlyMinting=true')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should include minting items', async () => {
          expect(returnedIds).toContain(mintingItemId)
        })
      })

      describe('when onlyListing filter is true', () => {
        let response: Response
        let responseBody: any
        let returnedIds: string[]

        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')

          const { localFetch } = components
          response = await localFetch.fetch('/v2/catalog?onlyListing=true')
          responseBody = await response.json()
          returnedIds = responseBody.data.map((item: Item) => item.itemId)
        })

        it('should respond with 200 status', async () => {
          expect(response.status).toEqual(200)
        })

        it('should include listing items', async () => {
          expect(returnedIds).toContain(listingItemId)
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

      it('should respond with 200 status', async () => {
        expect(response.status).toEqual(200)
      })

      it('should not include non-approved collection items', async () => {
        expect(returnedIds).not.toContain(notApprovedItemId)
      })
    })
  })
})
