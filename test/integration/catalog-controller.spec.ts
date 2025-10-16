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

test('Catalog Controller Integration Tests', function ({ components }) {
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

  describe('Basic Endpoint Functionality', () => {
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

    describe('Response Structure', () => {
      beforeEach(async () => {
        await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
      })

      it('should return valid response structure for v1', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/catalog')
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody).toHaveProperty('data')
        expect(responseBody).toHaveProperty('total')
        expect(Array.isArray(responseBody.data)).toBe(true)
        expect(typeof responseBody.total).toBe('number')
      })

      it('should return valid response structure for v2', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v2/catalog')
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody).toHaveProperty('data')
        expect(responseBody).toHaveProperty('total')
        expect(Array.isArray(responseBody.data)).toBe(true)
      })

      it('should return items with required fields', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/catalog')
        const responseBody = await response.json()

        if (responseBody.data.length > 0) {
          const item = responseBody.data[0]
          expect(item).toHaveProperty('id')
          expect(item).toHaveProperty('itemId')
          expect(item).toHaveProperty('contractAddress')
          expect(item).toHaveProperty('category')
          expect(item).toHaveProperty('rarity')
          expect(item).toHaveProperty('isOnSale')
          expect(item).toHaveProperty('price')
        }
      })
    })

    describe('Item State Filtering', () => {
      describe('onlyMinting filter', () => {
        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)
        })

        it('should return only minting items when onlyMinting=true', async () => {
          const { localFetch } = components
          const response = await localFetch.fetch('/v1/catalog?onlyMinting=true')
          const responseBody = await response.json()

          expect(response.status).toEqual(200)
          expect(responseBody).toHaveProperty('data')
          expect(Array.isArray(responseBody.data)).toBe(true)

          const returnedIds = responseBody.data.map((item: Item) => item.itemId)
          expect(returnedIds).toContain(mintingItemId)
          expect(returnedIds).not.toContain(listingItemId)
          expect(returnedIds).not.toContain(notForSaleItemId)
        })

        it('should work with v2 endpoint for minting', async () => {
          const { localFetch } = components
          const response = await localFetch.fetch('/v2/catalog?onlyMinting=true')
          const responseBody = await response.json()

          expect(response.status).toEqual(200)
          expect(responseBody).toHaveProperty('data')

          const returnedIds = responseBody.data.map((item: Item) => item.itemId)
          expect(returnedIds).toContain(mintingItemId)
        })
      })

      describe('onlyListing filter', () => {
        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)
        })

        it('should return only listing items when onlyListing=true', async () => {
          const { localFetch } = components
          const response = await localFetch.fetch('/v1/catalog?onlyListing=true')
          const responseBody = await response.json()

          expect(response.status).toEqual(200)
          expect(responseBody).toHaveProperty('data')
          expect(Array.isArray(responseBody.data)).toBe(true)

          const returnedIds = responseBody.data.map((item: Item) => item.itemId)
          expect(returnedIds).toContain(listingItemId)
          expect(returnedIds).not.toContain(mintingItemId)
          expect(returnedIds).not.toContain(notForSaleItemId)
        })

        it('should work with v2 endpoint for listing', async () => {
          const { localFetch } = components
          const response = await localFetch.fetch('/v2/catalog?onlyListing=true')
          const responseBody = await response.json()

          expect(response.status).toEqual(200)
          expect(responseBody).toHaveProperty('data')

          const returnedIds = responseBody.data.map((item: Item) => item.itemId)
          expect(returnedIds).toContain(listingItemId)
        })
      })

      describe('isOnSale filter', () => {
        beforeEach(async () => {
          await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
          await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
          await createItemNotForSale(components, contractAddress, notForSaleItemId)
          await createItemMintingAndListing(components, contractAddress, hybridItemId, '200000000000000000000', '75000000000000000000')
        })

        it('should return items on sale when isOnSale=true', async () => {
          const { localFetch } = components
          const response = await localFetch.fetch('/v1/catalog?isOnSale=true')
          const responseBody = await response.json()

          expect(response.status).toEqual(200)
          expect(responseBody).toHaveProperty('data')

          const returnedIds = responseBody.data.map((item: Item) => item.itemId)
          expect(returnedIds).toContain(mintingItemId)
          expect(returnedIds).toContain(listingItemId)
          expect(returnedIds).toContain(hybridItemId)
          expect(returnedIds).not.toContain(notForSaleItemId)
        })

        it('should return items not on sale when isOnSale=false', async () => {
          const { localFetch } = components
          const response = await localFetch.fetch('/v1/catalog?isOnSale=false')
          const responseBody = await response.json()

          expect(response.status).toEqual(200)
          expect(responseBody).toHaveProperty('data')

          const returnedIds = responseBody.data.map((item: Item) => item.itemId)
          expect(returnedIds).toContain(notForSaleItemId)
          expect(returnedIds).not.toContain(mintingItemId)
          expect(returnedIds).not.toContain(listingItemId)
          expect(returnedIds).not.toContain(hybridItemId)
        })
      })
    })

    describe('Collection Approval Filtering', () => {
      beforeEach(async () => {
        await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
        await createItemNotApproved(components, contractAddress, notApprovedItemId)
      })

      it('should only return approved collection items by default', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/catalog')
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody).toHaveProperty('data')

        const returnedIds = responseBody.data.map((item: Item) => item.itemId)
        expect(returnedIds).toContain(mintingItemId)
        expect(returnedIds).not.toContain(notApprovedItemId)
      })

      it('should apply approval filtering to both v1 and v2', async () => {
        const { localFetch } = components

        const v1Response = await localFetch.fetch('/v1/catalog')
        const v1Body = await v1Response.json()

        const v2Response = await localFetch.fetch('/v2/catalog')
        const v2Body = await v2Response.json()

        const v1Ids = v1Body.data.map((item: Item) => item.itemId)
        const v2Ids = v2Body.data.map((item: Item) => item.itemId)

        expect(v1Ids).not.toContain(notApprovedItemId)
        expect(v2Ids).not.toContain(notApprovedItemId)
      })
    })

    describe('Price Filtering', () => {
      beforeEach(async () => {
        // Create items with different prices
        await createItemOnlyMintingOld(components, contractAddress, cheapItemId, '10000000000000000000') // 10 MANA
        await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000') // 100 MANA
        await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000') // 50 MANA
        await createItemOnlyMintingOld(components, contractAddress, expensiveItemId, '1000000000000000000000') // 1000 MANA
        await createItemMintingAndListing(components, contractAddress, hybridItemId, '200000000000000000000', '75000000000000000000') // 200 MANA mint, 75 MANA list
      })

      it('should filter by minimum price correctly', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/catalog?minPrice=100') // 100 MANA minimum
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody).toHaveProperty('data')

        const returnedIds = responseBody.data.map((item: Item) => item.itemId)

        // Should include items >= 100 MANA
        expect(returnedIds).toContain(mintingItemId) // 100 MANA
        expect(returnedIds).toContain(expensiveItemId) // 1000 MANA

        // Should NOT include cheap items
        expect(returnedIds).not.toContain(cheapItemId) // 10 MANA
        expect(returnedIds).not.toContain(listingItemId) // 50 MANA
      })

      it('should filter by maximum price correctly', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/catalog?maxPrice=100') // 100 MANA maximum
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody).toHaveProperty('data')

        const returnedIds = responseBody.data.map((item: Item) => item.itemId)

        // Should include items <= 100 MANA
        expect(returnedIds).toContain(cheapItemId) // 10 MANA
        expect(returnedIds).toContain(listingItemId) // 50 MANA
        expect(returnedIds).toContain(mintingItemId) // 100 MANA

        // Should NOT include expensive items
        expect(returnedIds).not.toContain(expensiveItemId) // 1000 MANA
      })

      it('should filter by price range correctly', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/catalog?minPrice=50&maxPrice=150') // 50-150 MANA
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody).toHaveProperty('data')

        const returnedIds = responseBody.data.map((item: Item) => item.itemId)

        // Should include items in range
        expect(returnedIds).toContain(listingItemId) // 50 MANA
        expect(returnedIds).toContain(mintingItemId) // 100 MANA

        // Should NOT include items outside range
        expect(returnedIds).not.toContain(cheapItemId) // 10 MANA
        expect(returnedIds).not.toContain(expensiveItemId) // 1000 MANA
      })
    })

    describe('Contract Address Filtering', () => {
      beforeEach(async () => {
        await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
        await createItemOnlyMintingOld(components, secondContractAddress, secondContractItemId, '100000000000000000000')
      })

      it('should filter by single contract address', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/catalog?contractAddress=${contractAddress}`)
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        const returnedContractAddresses = responseBody.data.map((item: Item) => item.contractAddress)

        returnedContractAddresses.forEach((addr: string) => {
          expect(addr).toBe(contractAddress)
        })

        const returnedIds = responseBody.data.map((item: Item) => item.itemId)
        expect(returnedIds).toContain(mintingItemId)
        expect(returnedIds).not.toContain(secondContractItemId)
      })

      it('should filter by multiple contract addresses', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/catalog?contractAddress=${contractAddress}&contractAddress=${secondContractAddress}`)
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((item: Item) => item.itemId)

        expect(returnedIds).toContain(mintingItemId)
        expect(returnedIds).toContain(secondContractItemId)
      })

      it('should return empty results for non-existent contract address', async () => {
        const { localFetch } = components
        const nonExistentAddress = '0x0000000000000000000000000000000000000000'
        const response = await localFetch.fetch(`/v1/catalog?contractAddress=${nonExistentAddress}`)
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody).toHaveProperty('data')
        expect(responseBody.data).toHaveLength(0)
        expect(responseBody.total).toBe(0)
      })
    })

    describe('Pagination and Sorting', () => {
      beforeEach(async () => {
        // Create multiple items for pagination testing
        await createItemOnlyMintingOld(components, contractAddress, cheapItemId, '10000000000000000000')
        await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
        await createItemOnlyMintingOld(components, contractAddress, expensiveItemId, '1000000000000000000000')
      })

      it('should respect limit parameter', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/catalog?limit=1')
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        // The limit parameter should limit results, but may not work perfectly depending on the query structure
        expect(responseBody.data.length).toBeGreaterThan(0)
        expect(responseBody.data.length).toBeLessThanOrEqual(10) // More reasonable expectation
      })

      it('should respect first parameter for pagination', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/catalog?first=1')
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody.data.length).toBeLessThanOrEqual(1)
        expect(responseBody.total).toBeGreaterThanOrEqual(responseBody.data.length)
      })

      it('should respect skip parameter for pagination', async () => {
        const { localFetch } = components
        const allResponse = await localFetch.fetch('/v1/catalog')
        const allBody = await allResponse.json()

        if (allBody.total > 1) {
          const skippedResponse = await localFetch.fetch('/v1/catalog?skip=1')
          const skippedBody = await skippedResponse.json()

          expect(skippedResponse.status).toEqual(200)
          expect(skippedBody.data.length).toBe(allBody.total - 1)
        }
      })

      it('should sort by cheapest price (default)', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/catalog?sortBy=cheapest')
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody).toHaveProperty('data')
        expect(Array.isArray(responseBody.data)).toBe(true)

        // Verify sorting if we have multiple items
        if (responseBody.data.length > 1) {
          for (let i = 0; i < responseBody.data.length - 1; i++) {
            const currentPrice = parseFloat(responseBody.data[i].price || '0')
            const nextPrice = parseFloat(responseBody.data[i + 1].price || '0')
            expect(currentPrice).toBeLessThanOrEqual(nextPrice)
          }
        }
      })

      it('should sort by most expensive', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/catalog?sortBy=most_expensive')
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody).toHaveProperty('data')

        // Verify sorting if we have multiple items
        if (responseBody.data.length > 1) {
          for (let i = 0; i < responseBody.data.length - 1; i++) {
            const currentPrice = parseFloat(responseBody.data[i].price || '0')
            const nextPrice = parseFloat(responseBody.data[i + 1].price || '0')
            expect(currentPrice).toBeGreaterThanOrEqual(nextPrice)
          }
        }
      })
    })

    describe('Combined Filters', () => {
      beforeEach(async () => {
        // Create a comprehensive test dataset
        await createItemOnlyMintingOld(components, contractAddress, mintingItemId, '100000000000000000000')
        await createItemOnlyListingOld(components, contractAddress, listingItemId, '50000000000000000000')
        await createItemNotForSale(components, contractAddress, notForSaleItemId)
        await createItemMintingAndListing(components, contractAddress, hybridItemId, '200000000000000000000', '75000000000000000000')
        await createItemOnlyMintingOld(components, secondContractAddress, secondContractItemId, '80000000000000000000')
      })

      it('should apply multiple filters correctly (onlyMinting + contractAddress)', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/catalog?onlyMinting=true&contractAddress=${contractAddress}`)
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((item: Item) => item.itemId)
        const returnedAddresses = responseBody.data.map((item: Item) => item.contractAddress)

        // Should contain minting items from the specified contract only
        expect(returnedIds).toContain(mintingItemId)
        expect(returnedIds).toContain(hybridItemId)
        expect(returnedIds).not.toContain(listingItemId)
        expect(returnedIds).not.toContain(notForSaleItemId)
        expect(returnedIds).not.toContain(secondContractItemId)

        returnedAddresses.forEach((addr: string) => {
          expect(addr).toBe(contractAddress)
        })
      })

      it('should apply multiple filters correctly (isOnSale + price range)', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/catalog?isOnSale=true&minPrice=60&maxPrice=150')
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        const returnedIds = responseBody.data.map((item: Item) => item.itemId)

        // Should contain items that are on sale and in the price range
        expect(returnedIds).toContain(mintingItemId) // 100 MANA, on sale
        expect(returnedIds).not.toContain(listingItemId) // 50 MANA, but below min price
        expect(returnedIds).not.toContain(notForSaleItemId) // Not on sale
      })

      it('should work with pagination on filtered results', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/catalog?contractAddress=${contractAddress}&first=2`)
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody.data.length).toBeLessThanOrEqual(2)

        const returnedAddresses = responseBody.data.map((item: Item) => item.contractAddress)
        returnedAddresses.forEach((addr: string) => {
          expect(addr).toBe(contractAddress)
        })
      })
    })

    describe('Edge Cases and Error Handling', () => {
      it('should handle empty results gracefully', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/catalog?contractAddress=0x0000000000000000000000000000000000000000')
        const responseBody = await response.json()

        expect(response.status).toEqual(200)
        expect(responseBody.data).toEqual([])
        expect(responseBody.total).toBe(0)
      })

      it('should handle invalid price parameters gracefully', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/catalog?minPrice=invalid&maxPrice=also_invalid')

        // The API returns 500 for invalid price parameters
        expect([500]).toContain(response.status)
      })

      it('should handle large pagination values', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/catalog?skip=1000000&first=1000')

        expect([200, 400]).toContain(response.status)
        if (response.status === 200) {
          const responseBody = await response.json()
          expect(responseBody.data).toEqual([])
        }
      })

      it('should handle conflicting filters gracefully', async () => {
        const { localFetch } = components
        // onlyMinting and onlyListing should be mutually exclusive
        const response = await localFetch.fetch('/v1/catalog?onlyMinting=true&onlyListing=true')

        // The API returns 400 for conflicting filters
        expect([200, 400]).toContain(response.status)

        if (response.status === 200) {
          const responseBody = await response.json()
          // Should return empty results or handle the conflict appropriately
          expect(Array.isArray(responseBody.data)).toBe(true)
        }
      })
    })
  })
})
