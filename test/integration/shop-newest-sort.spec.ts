import { test } from '../components'
import {
  createSearchableWearable,
  createSearchNativeTrade,
  deleteSearchableCollection,
  deleteSearchableWearable,
  deleteSearchTrade
} from './utils/dbSearch'

/**
 * `newest` end to end against a REAL Postgres, which the unit specs can only assert as SQL text.
 *
 * A signed listing cannot be edited, so changing its price cancels it and signs a new one. The feed must keep
 * sorting on when each item first went on sale: the relisted item stays behind one that went on sale after it,
 * even though its listing is now the most recent of the two.
 */
test('when the shop feeds are sorted by newest', function ({ components }) {
  const CONTRACT = '0x5ea0000000000000000000000000000000000001'
  const EARLIER = { itemId: '1', name: 'On Sale Since Long Ago', firstListedAt: 1600000000 }
  const LATER = { itemId: '2', name: 'On Sale Since Recently', firstListedAt: 1700000000 }

  let tradeIds: string[]

  async function fetchNames(path: string): Promise<string[]> {
    const response = await components.localFetch.fetch(path)
    expect(response.status).toEqual(200)
    const body = (await response.json()) as { data: { name: string }[] }
    return body.data.map(row => row.name)
  }

  beforeAll(async () => {
    for (const item of [EARLIER, LATER]) {
      // Not a store minter, so the only row each item contributes is its signed listing.
      await createSearchableWearable(components, {
        itemId: item.itemId,
        contractAddress: CONTRACT,
        name: item.name,
        isStoreMinterSet: false
      })
      await components.dappsDatabase.query(
        `UPDATE squid_marketplace."item" SET first_listed_at = ${item.firstListedAt} WHERE id = '${CONTRACT}-${item.itemId}'`
      )
    }
    // The later item is listed first and the earlier one relisted after it, so the earlier item holds the
    // newer listing: the order the old `created_at` sort put on top.
    const laterTrade = await createSearchNativeTrade(components, { contractAddress: CONTRACT, itemId: LATER.itemId })
    await components.dappsDatabase.query(`UPDATE marketplace.trades SET created_at = NOW() - INTERVAL '1 day' WHERE id = '${laterTrade}'`)
    const relistedTrade = await createSearchNativeTrade(components, { contractAddress: CONTRACT, itemId: EARLIER.itemId })
    tradeIds = [laterTrade, relistedTrade]
  })

  afterAll(async () => {
    for (const tradeId of tradeIds) await deleteSearchTrade(components, tradeId)
    for (const item of [EARLIER, LATER]) await deleteSearchableWearable(components, item.itemId, CONTRACT)
    await deleteSearchableCollection(components, CONTRACT)
  })

  describe('and an item that went on sale earlier has just been relisted', () => {
    it('should list the item that went on sale later first in the listing feed', async () => {
      expect(await fetchNames(`/v3/catalog/unified?contractAddress=${CONTRACT}&sortBy=newest`)).toEqual([LATER.name, EARLIER.name])
    })

    it('should list the item that went on sale later first in the item feed', async () => {
      expect(await fetchNames(`/v3/catalog/unified?groupBy=item&contractAddress=${CONTRACT}&sortBy=newest`)).toEqual([
        LATER.name,
        EARLIER.name
      ])
    })

    it('should list the item that went on sale later first in the USD listings feed', async () => {
      expect(await fetchNames(`/v3/catalog/shop?contractAddress=${CONTRACT}&sortBy=newest`)).toEqual([LATER.name, EARLIER.name])
    })

    it('should keep reporting each listing its own creation date', async () => {
      const response = await components.localFetch.fetch(`/v3/catalog/unified?contractAddress=${CONTRACT}&sortBy=newest`)
      const body = (await response.json()) as { data: { name: string; createdAt: number }[] }
      const createdAt = Object.fromEntries(body.data.map(row => [row.name, row.createdAt]))

      expect(createdAt[EARLIER.name]).toBeGreaterThan(createdAt[LATER.name])
    })
  })
})
