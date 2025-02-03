import { test } from '../components'
import { CreateDBItemOptions, createSquidDBItem, deleteSquidDBItem } from './utils/dbItems'

test('when getting an item', function ({ components }) {
  const contractAddress = '0xcf898476136602cd9d61e65945b5ecf9128ff339'
  const itemId = '0'

  describe('and it does not exist', () => {
    beforeEach(async () => {
      await deleteSquidDBItem(components, itemId, contractAddress)
    })

    it('should respond with a 200 and an empty array of items', async () => {
      const { localFetch } = components
      const response = await localFetch.fetch(`/v1/items?contractAddress=${contractAddress}&itemId=${itemId}`)
      const responseBody = await response.json()
      expect(response.status).toEqual(200)
      expect(responseBody).toEqual({ data: [], total: 0 })
    })
  })

  describe('and it exists', () => {
    let createDBItemOptions: CreateDBItemOptions

    beforeEach(async () => {
      createDBItemOptions = { itemId, contractAddress }
    })

    afterEach(async () => {
      await deleteSquidDBItem(components, itemId, contractAddress)
    })

    describe("and there's no trade nor the marketplace is the minter of the item", () => {
      beforeEach(async () => {
        await createSquidDBItem(components, { ...createDBItemOptions, isStoreMinterSet: false })
      })

      it('should respond with a 200 and the item which has no trades and is not on sale', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/items?contractAddress=${contractAddress}&itemId=${itemId}`)
        const responseBody = await response.json()
        expect(response.status).toEqual(200)
        expect(responseBody).toEqual({
          data: [
            expect.objectContaining({ id: `${contractAddress}_${itemId}`, itemId: '0', contractAddress, tradeId: null, isOnSale: false })
          ],
          total: 1
        })
      })
    })

    describe('and the marketplace is the minter of the item', () => {
      beforeEach(async () => {
        await createSquidDBItem(components, { ...createDBItemOptions, isStoreMinterSet: true })
      })

      it('should respond with a 200 and the item which has no trades and is on sale', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/items?contractAddress=${contractAddress}&itemId=${itemId}`)
        const responseBody = await response.json()
        expect(response.status).toEqual(200)
        expect(responseBody).toEqual({
          data: [expect.objectContaining({ id: `${contractAddress}_${itemId}`, itemId, contractAddress, tradeId: null, isOnSale: true })],
          total: 1
        })
      })
    })
  })
})
