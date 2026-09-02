import nock from 'nock'
import { NFT, Order } from '@dcl/schemas'
import { test } from '../components'
import { createParcelNFT, deleteSquidDBNFT, createNFTOnSaleTrade, deleteSquidDBTrade } from './utils/dbItems'

/** The rentals reads every NFT response makes; unmocked they fail the request before it is answered. */
function mockRentals(): void {
  const empty = { ok: true, data: { results: [], total: 0, page: 1, pages: 1, limit: 24 } }
  for (const host of ['https://signatures-api.decentraland.zone', 'https://signatures-api.decentraland.org']) {
    nock(host)
      .persist()
      .get(/\/v1\/rentals-listings.*/)
      .reply(200, empty)
  }
  nock('https://subgraph.decentraland.org')
    .persist()
    .post(/.*/)
    .reply(200, { data: { rentalAssets: [] } })
  nock('https://subgraph.decentraland.org')
    .persist()
    .get(/.*/)
    .reply(200, { data: { rentalAssets: [] } })
  nock.disableNetConnect()
  nock.enableNetConnect(/(localhost|0\.0\.0\.0)/)
}

interface NFTsResponse {
  data: Array<{ nft: NFT; order: Order | null }>
  total: number
}

/**
 * LAND BROWSE: THE RESULT SET AND ITS COUNT.
 *
 * A LAND is on sale through one of two rails — an on-chain order or an off-chain trade — and this feed
 * UNIONs them. Both bugs covered here came from treating one rail as if it were the whole set.
 */
test('when browsing LAND', function ({ components }) {
  const CONTRACT = '0x959e104e1a4db6317fa58f8295f586e1a978c297'

  /** A LAND's nft id carries a category prefix; its seeded order row does not use the same spelling. */
  const landId = (tokenId: string) => `parcel-${CONTRACT}-${tokenId}`

  /**
   * The shared helper writes the order row but leaves `nft.active_order_id` unset, and it addresses that
   * row by an nft_id spelled without the `parcel-` prefix the nft itself carries. The on-sale LAND query
   * joins on `nft.active_order_id`, so an NFT seeded with `isOnSale` alone never reaches this feed at all.
   * Linked here, by the identity both rows really share, rather than in the helper — the 55 tests already
   * built on its current behaviour should not move for this.
   */
  async function landOnSaleByOrder(tokenId: string, name: string) {
    await createParcelNFT(components, CONTRACT, tokenId, { name, isOnSale: true })
    await components.dappsDatabase.query(
      `UPDATE squid_marketplace.nft SET active_order_id = (
         SELECT id FROM squid_marketplace."order"
          WHERE nft_address = '${CONTRACT}' AND token_id = ${tokenId} AND status = 'open' LIMIT 1
       ) WHERE id = '${landId(tokenId)}'`
    )
  }

  async function landOnSaleByTrade(tokenId: string, name: string) {
    await createParcelNFT(components, CONTRACT, tokenId, { name })
    return createNFTOnSaleTrade(components, CONTRACT, tokenId)
  }

  const orderTokens = ['910001', '910002']
  const tradeTokens = ['910003', '910004', '910005']
  const tradeIds: string[] = []

  beforeEach(async () => {
    mockRentals()
    await landOnSaleByOrder(orderTokens[0], 'Aurora Field')
    await landOnSaleByOrder(orderTokens[1], 'Basalt Ridge')
    for (const [i, token] of tradeTokens.entries()) {
      tradeIds.push(await landOnSaleByTrade(token, ['Cobalt Hollow', 'Dune Terrace', 'Ember Flats'][i]))
    }
  })

  afterEach(async () => {
    nock.cleanAll()
    nock.enableNetConnect()
    for (const id of tradeIds.splice(0)) await deleteSquidDBTrade(components, id)
    for (const token of [...orderTokens, ...tradeTokens]) await deleteSquidDBNFT(components, token, CONTRACT)
  })

  /** What the database says is on sale, by the same two rails the endpoint reads. */
  async function landOnSaleInDB(): Promise<number> {
    const { rows } = await components.dappsDatabase.query<{ count: string }>(`
      SELECT count(*) AS count FROM (
        SELECT n.id FROM squid_marketplace.nft n
          JOIN squid_marketplace."order" o ON o.id = n.active_order_id AND o.status = 'open'
         WHERE n.search_is_land AND n.contract_address = '${CONTRACT}'
        UNION
        SELECT n.id FROM squid_marketplace.nft n
          JOIN marketplace.mv_trades mv ON mv.sent_nft_id = n.id AND mv.status = 'open'
         WHERE n.search_is_land AND n.contract_address = '${CONTRACT}'
      ) both_rails`)
    return Number(rows[0].count)
  }

  /** `category` is what routes the request down the LAND path at all — without it the generic NFT query
   *  answers instead, and it counts differently. */
  const browse = async (qs: string): Promise<NFTsResponse> =>
    (await components.localFetch.fetch(`/v1/nfts?contractAddress=${CONTRACT}&category=parcel&${qs}`)).json()

  describe('and sorting by Recently Listed', () => {
    /**
     * The trades CTE limited itself to one page, while the orders it is unioned with stayed whole, so the
     * count became "every order + one page of trades" and grew with the page size. Production reported 72
     * parcels on sale at first=1 and 97 at first=48, against a real 194.
     */
    it('should report the same total whatever the page size, and it should be the database count', async () => {
      const expected = await landOnSaleInDB()
      expect(expected).toBe(5)

      const totals = []
      for (const first of [1, 2, 5, 10]) {
        totals.push((await browse(`isOnSale=true&sortBy=recently_listed&first=${first}`)).total)
      }

      expect(totals).toEqual([expected, expected, expected, expected])
    })

    it('should report the same total as every other sort, which never had the truncation', async () => {
      const recent = await browse('isOnSale=true&sortBy=recently_listed&first=1')
      const newest = await browse('isOnSale=true&sortBy=newest&first=1')
      const cheapest = await browse('isOnSale=true&sortBy=cheapest&first=1')

      expect(recent.total).toBe(newest.total)
      expect(recent.total).toBe(cheapest.total)
    })

    it('should let paging reach the trade-backed LAND that used to be unreachable', async () => {
      const firstPage = await browse('isOnSale=true&sortBy=recently_listed&first=3&skip=0')
      const secondPage = await browse('isOnSale=true&sortBy=recently_listed&first=3&skip=3')

      const ids = [...firstPage.data, ...secondPage.data].map(r => r.nft.id)
      expect(new Set(ids).size).toBe(5)
      expect(ids).toHaveLength(5)
    })

    it('should return the newest listing first', async () => {
      const { data } = await browse('isOnSale=true&sortBy=recently_listed&first=5')

      const names = data.map(r => r.nft.name)
      // The trades are seeded last, so they are the recent end of the set.
      expect(names.slice(0, 3).sort()).toEqual(['Cobalt Hollow', 'Dune Terrace', 'Ember Flats'])
    })

    /**
     * `order_created_at` is computed over the union further down the query; the pre-selection CTE reads the
     * nft table alone, where no such column exists. This answered HTTP 400 rather than a wrong order.
     */
    it('should not fail when the browse is not narrowed to what is on sale', async () => {
      const response = await components.localFetch.fetch(
        `/v1/nfts?contractAddress=${CONTRACT}&category=parcel&sortBy=recently_listed&first=5`
      )

      expect(response.status).toBe(200)
      expect((await response.json()).total).toBeGreaterThanOrEqual(5)
    })
  })

  describe('and searching by text', () => {
    /**
     * The search was applied inside the on-chain-order CTE only, and the trades CTE has no nft to match
     * against — so every trade-backed LAND ignored the term. On production, 299 LAND were on sale, 196 of
     * them trade-backed, and a search for a string matching nothing returned exactly those 196.
     */
    it('should not return trade-backed LAND that does not match the term', async () => {
      const { total, data } = await browse('isOnSale=true&search=zzzznomatch')

      expect(total).toBe(0)
      expect(data).toHaveLength(0)
    })

    it('should return the trade-backed LAND that does match, and only it', async () => {
      const { data } = await browse('isOnSale=true&search=Cobalt Hollow')

      expect(data.map(r => r.nft.name)).toEqual(['Cobalt Hollow'])
    })

    it('should still match order-backed LAND, which was never the broken rail', async () => {
      const { data } = await browse('isOnSale=true&search=Aurora Field')

      expect(data.map(r => r.nft.name)).toEqual(['Aurora Field'])
    })

    it('should agree with the database about which LAND matches', async () => {
      const { rows } = await components.dappsDatabase.query<{ count: string }>(
        `SELECT count(*) AS count FROM squid_marketplace.nft
          WHERE search_is_land AND contract_address = '${CONTRACT}' AND search_text % 'Cobalt Hollow'`
      )

      const { total } = await browse('isOnSale=true&search=Cobalt Hollow')

      expect(total).toBe(Number(rows[0].count))
    })
  })
})
