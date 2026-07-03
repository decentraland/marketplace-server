import { createShopCatalogComponent } from '../../src/ports/shop-catalog/component'
import { IShopCatalogComponent } from '../../src/ports/shop-catalog/types'

// 1 credit = $0.10 = 1e17 USD wei.
const WEI_PER_CREDIT = 100000000000000000n

function shopRow(overrides: Record<string, unknown> = {}) {
  return {
    trade_id: 'trade-1',
    trade_type: 'public_item_order',
    contract_address: '0xcollection',
    item_id: '3',
    token_id: null,
    name: 'Cool Hat',
    image: 'ipfs://hat.png',
    rarity: 'RARE',
    item_type: 'wearable_v2',
    wearable_category: 'hat',
    creator: '0xcreator',
    price: (5n * WEI_PER_CREDIT).toString(),
    available: '10',
    network: 'MATIC',
    created_at: '1700000000000',
    total: '1',
    ...overrides
  }
}

describe('Shop Catalog Component', () => {
  let shopCatalog: IShopCatalogComponent
  let query: jest.Mock
  let warn: jest.Mock

  beforeEach(() => {
    query = jest.fn()
    warn = jest.fn()
    const components = {
      dappsDatabase: { query },
      logs: { getLogger: jest.fn().mockReturnValue({ warn, info: jest.fn(), error: jest.fn(), debug: jest.fn() }) }
    } as any
    shopCatalog = createShopCatalogComponent(components)
  })

  describe('when converting a listing price to credits', () => {
    it('should map an exact whole-credit price straight through', async () => {
      query.mockResolvedValueOnce({ rows: [shopRow({ price: (5n * WEI_PER_CREDIT).toString() })] })

      const { data } = await shopCatalog.getShopListings({})

      expect(data[0].priceCredits).toBe(5)
    })

    it('should round a fractional-credit price UP so it never under-states the settlement amount', async () => {
      // $1.55 -> 1_550_000_000_000_000_000 wei -> 15.5 credits -> ceil 16.
      query.mockResolvedValueOnce({ rows: [shopRow({ price: '1550000000000000000' })] })

      const { data } = await shopCatalog.getShopListings({})

      expect(data[0].priceCredits).toBe(16)
    })

    it('should drop listings with a non-positive or unparseable price instead of advertising a free item', async () => {
      query.mockResolvedValueOnce({
        rows: [
          shopRow({ trade_id: 'ok', price: (2n * WEI_PER_CREDIT).toString(), total: '3' }),
          shopRow({ trade_id: 'zero', price: '0', total: '3' }),
          shopRow({ trade_id: 'nan', price: 'not-a-number', total: '3' })
        ]
      })

      const { data, total } = await shopCatalog.getShopListings({})

      expect(data).toHaveLength(1)
      expect(data[0].tradeId).toBe('ok')
      // total comes from COUNT(*) OVER() and is not reduced by dropped rows.
      expect(total).toBe(3)
      expect(warn).toHaveBeenCalledTimes(2)
    })
  })

  describe('when mapping a listing row', () => {
    it('should lowercase the rarity and tag primary/secondary from the trade type', async () => {
      query.mockResolvedValueOnce({
        rows: [shopRow({ rarity: 'MYTHIC', trade_type: 'public_nft_order', token_id: '99', item_id: null })]
      })

      const { data } = await shopCatalog.getShopListings({})

      expect(data[0]).toMatchObject({ rarity: 'mythic', listingType: 'secondary', tokenId: '99' })
    })
  })

  describe('when building the shop listings query', () => {
    beforeEach(() => {
      query.mockResolvedValue({ rows: [] })
    })

    it('should only include USD-pegged (asset_type = 2) received assets', async () => {
      await shopCatalog.getShopListings({})

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain("ta.direction = 'received' AND ta.asset_type =")
      expect(sql.values).toContain(2)
    })

    it('should clamp pagination to the default page size and a zero offset', async () => {
      await shopCatalog.getShopListings({})

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('LIMIT')
      expect(sql.text).toContain('OFFSET')
      expect(sql.values).toEqual(expect.arrayContaining([48, 0]))
    })

    it('should clamp an oversized page size to the maximum and floor non-integers', async () => {
      await shopCatalog.getShopListings({ first: 99999, skip: 10.7 })

      const sql = query.mock.calls[0][0]
      expect(sql.values).toEqual(expect.arrayContaining([1000, 10]))
    })

    it('should never place a user-supplied sort value into the SQL text', async () => {
      await shopCatalog.getShopListings({ sortBy: 'cheapest' })
      expect(query.mock.calls[0][0].text).toContain('ORDER BY mv.amount_received ASC')

      query.mockClear()
      await shopCatalog.getShopListings({})
      expect(query.mock.calls[0][0].text).toContain('ORDER BY mv.created_at DESC')
    })

    it('should bind a name search as a parameterized ILIKE', async () => {
      await shopCatalog.getShopListings({ search: 'Cool' })

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('ILIKE')
      expect(sql.values).toContain('%Cool%')
    })

    it('should lowercase rarities and bind them as an array', async () => {
      await shopCatalog.getShopListings({ rarities: ['Rare', 'EPIC'] })

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('lower(COALESCE(item_p.rarity, item_s.rarity, nft.search_wearable_rarity)) = ANY(')
      expect(sql.values).toContainEqual(['rare', 'epic'])
    })

    it('should lowercase wearable categories on both sides of the comparison', async () => {
      await shopCatalog.getShopListings({ wearableCategories: ['Upper_Body', 'HAT'] })

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('lower(COALESCE(item_p.search_wearable_category')
      expect(sql.values).toContainEqual(['upper_body', 'hat'])
    })

    it('should translate credit price bounds into USD wei', async () => {
      await shopCatalog.getShopListings({ minPriceCredits: 3, maxPriceCredits: 10 })

      const sql = query.mock.calls[0][0]
      expect(sql.values).toContain((3n * WEI_PER_CREDIT).toString())
      expect(sql.values).toContain((10n * WEI_PER_CREDIT).toString())
    })

    it('should ignore a non-finite price bound instead of throwing on BigInt(Infinity)', async () => {
      await expect(shopCatalog.getShopListings({ minPriceCredits: Infinity, maxPriceCredits: Infinity })).resolves.toBeDefined()

      const sql = query.mock.calls[0][0]
      expect(sql.text).not.toContain('mv.amount_received >=')
      expect(sql.text).not.toContain('mv.amount_received <=')
    })

    it('should escape ILIKE wildcards in the search term', async () => {
      await shopCatalog.getShopListings({ search: '50%_off' })

      const sql = query.mock.calls[0][0]
      // % and _ are escaped so they match literally instead of acting as wildcards.
      expect(sql.values).toContain('%50\\%\\_off%')
    })
  })

  describe('when fetching a seller importable listings', () => {
    it('should only include classic ERC20 (asset_type = 1) listings for the lowercased seller', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            old_trade_id: 'old-1',
            trade_type: 'public_item_order',
            contract_address: '0xcollection',
            item_id: '3',
            token_id: null,
            name: 'Legacy Hat',
            image: 'ipfs://hat.png',
            rarity: 'rare',
            item_type: 'wearable_v2',
            wearable_category: 'hat',
            mana_wei: '1000000000000000000',
            available: '1',
            network: 'MATIC'
          }
        ]
      })

      const data = await shopCatalog.getImportableListings('0xABCDEF')

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('lower(mv.signer) =')
      expect(sql.text).toContain('LIMIT')
      expect(sql.values).toContain('0xabcdef')
      expect(sql.values).toContain(1)
      expect(data[0]).toMatchObject({ oldTradeId: 'old-1', manaWei: '1000000000000000000', listingType: 'primary' })
    })
  })
})
