import { NO_PRICE_SENTINEL } from '../../src/constants'
import { test } from '../components'
import { createSquidDBItem, deleteSquidDBItem } from './utils/dbItems'

const CONTRACT = '0x7f3e5a1b9c2d4e6f8a0b1c3d5e7f9a1b3c5d7e9f'
const NO_PRICE_ITEM = '801'
const ABSURD_PRICE_ITEM = '802'
const PRICED_ITEM = '803'
// Just under the sentinel: clears a sentinel-only check and still overflows bigint once converted to credits.
const ABSURD_PRICE = (BigInt(NO_PRICE_SENTINEL) - 1n).toString()

type CatalogItemsResponse = { data: { id: string; priceCredits: number }[]; total: number }

test('when the catalogue holds store items priced beyond what a credit price can hold', function ({ components }) {
  beforeEach(async () => {
    await createSquidDBItem(components, {
      itemId: NO_PRICE_ITEM,
      contractAddress: CONTRACT,
      isStoreMinterSet: true,
      available: 5,
      price: NO_PRICE_SENTINEL
    })
    await createSquidDBItem(components, {
      itemId: ABSURD_PRICE_ITEM,
      contractAddress: CONTRACT,
      isStoreMinterSet: true,
      available: 5,
      price: ABSURD_PRICE
    })
    await createSquidDBItem(components, {
      itemId: PRICED_ITEM,
      contractAddress: CONTRACT,
      isStoreMinterSet: true,
      available: 5,
      price: '100000000000000000000'
    })
  })

  afterEach(async () => {
    await deleteSquidDBItem(components, NO_PRICE_ITEM, CONTRACT)
    await deleteSquidDBItem(components, ABSURD_PRICE_ITEM, CONTRACT)
    await deleteSquidDBItem(components, PRICED_ITEM, CONTRACT)
  })

  describe('and the items are requested by id', () => {
    let status: number
    let prices: Record<string, number>

    beforeEach(async () => {
      const query = [NO_PRICE_ITEM, ABSURD_PRICE_ITEM, PRICED_ITEM].map(itemId => `id=${CONTRACT}_${itemId}`).join('&')
      const response = await components.localFetch.fetch(`/v3/catalog/items?first=3&${query}`)
      status = response.status
      const body = (await response.json()) as CatalogItemsResponse
      prices = Object.fromEntries((body.data ?? []).map(item => [item.id, item.priceCredits]))
    })

    it('should respond with a 200', () => {
      expect(status).toEqual(200)
    })

    it('should price the items beyond range at 0 credits and keep the real price of the rest', () => {
      expect(prices).toEqual({
        [`${CONTRACT}_${NO_PRICE_ITEM}`]: 0,
        [`${CONTRACT}_${ABSURD_PRICE_ITEM}`]: 0,
        [`${CONTRACT}_${PRICED_ITEM}`]: expect.any(Number)
      })
    })

    it('should give the item with a real price a positive credit price', () => {
      expect(prices[`${CONTRACT}_${PRICED_ITEM}`]).toBeGreaterThan(0)
    })
  })

  describe('and the collection is sorted by most expensive', () => {
    let status: number
    let ids: string[]

    beforeEach(async () => {
      const response = await components.localFetch.fetch(`/v3/catalog/items?contractAddress=${CONTRACT}&sortBy=most_expensive`)
      status = response.status
      const body = (await response.json()) as CatalogItemsResponse
      ids = (body.data ?? []).map(item => item.id)
    })

    it('should respond with a 200', () => {
      expect(status).toEqual(200)
    })

    it('should list the item with a real price first', () => {
      expect(ids[0]).toEqual(`${CONTRACT}_${PRICED_ITEM}`)
    })
  })
})
