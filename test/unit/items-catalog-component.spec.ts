import { Network, Rarity } from '@dcl/schemas'
import { createItemsComponent } from '../../src/ports/items'
import { CatalogDBItem, IItemsComponent, ItemType } from '../../src/ports/items/types'
import { createTestLogsComponent, createTestPgComponent } from '../components'

// A catalog-items row: the columns fromDBItemToItem consumes plus the SQL-computed price_credits. The
// asset-aware credit conversion happens in SQL, so the row supplies price_credits directly; the
// SQL-shape assertions below cover the conversion (rate vs no-rate) itself.
function catalogRow(overrides: Partial<CatalogDBItem> = {}): CatalogDBItem {
  return {
    count: 1,
    id: '0xcollection-3',
    image: 'ipfs://hat.png',
    uri: 'url',
    item_type: ItemType.WEARABLE_V2,
    item_id: '3',
    contract_address: '0xcollection',
    rarity: Rarity.RARE,
    price: '0',
    available: 10,
    creator: '0xcreator',
    beneficiary: '0x',
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    reviewed_at: 1_700_000_000,
    sold_at: 0,
    urn: 'urn',
    name: 'Cool Hat',
    network: Network.MATIC,
    search_is_store_minter: true,
    search_is_marketplace_v3_minter: false,
    first_listed_at: new Date(1_700_000_000_000),
    trade_price: '0',
    price_credits: '5',
    ...overrides
  } as CatalogDBItem
}

describe('Items catalog feed (getCatalogItems)', () => {
  let items: IItemsComponent
  let query: jest.Mock
  const RATE = 0.5
  const RATE_STR = RATE.toFixed(18)

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 })
    const dappsDatabase = createTestPgComponent({ query })
    const logs = createTestLogsComponent({
      getLogger: jest.fn().mockReturnValue({ error: () => undefined, info: () => undefined, warn: () => undefined, debug: () => undefined })
    })
    items = createItemsComponent({ dappsDatabase, logs })
  })

  describe('when mapping a catalog item row', () => {
    it('should attach the SQL-computed priceCredits to the /v1/items item shape', async () => {
      query.mockResolvedValueOnce({ rows: [catalogRow({ price_credits: '5' })], rowCount: 1 })

      const { data, total } = await items.getCatalogItems({}, RATE)

      expect(total).toBe(1)
      expect(data[0]).toMatchObject({
        id: '0xcollection-3',
        contractAddress: '0xcollection',
        itemId: '3',
        priceCredits: 5
      })
    })

    it('should map a not-for-sale item (price_credits 0) to priceCredits 0', async () => {
      query.mockResolvedValueOnce({
        rows: [catalogRow({ available: 0, search_is_store_minter: false, price_credits: '0' })],
        rowCount: 1
      })

      const { data } = await items.getCatalogItems({}, RATE)

      expect(data[0].priceCredits).toBe(0)
    })

    it('should treat a null price_credits as 0 instead of NaN', async () => {
      query.mockResolvedValueOnce({ rows: [catalogRow({ price_credits: null })], rowCount: 1 })

      const { data } = await items.getCatalogItems({}, RATE)

      expect(data[0].priceCredits).toBe(0)
    })
  })

  describe('when building the catalog-items query', () => {
    it('should compute an asset-type-aware price_credits column keyed on the USD-pegged asset type', async () => {
      await items.getCatalogItems({}, RATE)

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('AS price_credits')
      // The USD-pegged branch is selected by the received asset type (USD_PEGGED_MANA = 2).
      expect(sql.text).toContain("ta.direction = 'received'")
      expect(sql.values).toContain(2)
    })

    it('should pass USD-pegged amounts straight through (no rate) but multiply MANA amounts by the rate', async () => {
      await items.getCatalogItems({}, RATE)

      const sql = query.mock.calls[0][0]
      // USD-pegged trade: divide the raw amount by the wei-per-credit only -- never multiplied by a rate.
      expect(sql.text).toContain("THEN CEIL((unified_trades.assets -> 'received' ->> 'amount')::numeric / ")
      // MANA store-minter price: multiplied by the bound rate before dividing.
      expect(sql.text).toContain('CEIL(item.price::numeric * ')
      // The rate is bound as a parameter, never interpolated into the text.
      expect(sql.values).toContain(RATE_STR)
    })

    it('should ceil-round to whole credits so a credit price never under-states the settlement amount', async () => {
      await items.getCatalogItems({}, RATE)

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('CEIL(')
      expect(sql.text).toContain('::bigint AS price_credits')
    })

    it('should degrade to a 0 rate literal for a broken (non-positive) rate rather than pricing off it', async () => {
      await items.getCatalogItems({}, 0)

      const sql = query.mock.calls[0][0]
      expect(sql.values).toContain('0')
    })

    it('should filter by a lowercased creator', async () => {
      await items.getCatalogItems({ creator: ['0xABCDEF'] }, RATE)

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('LOWER(item.creator) = ANY(')
      expect(sql.values).toContainEqual(['0xabcdef'])
    })

    it('should filter by contract address (collection)', async () => {
      await items.getCatalogItems({ contractAddresses: ['0xcollection'] }, RATE)

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('item.collection_id = ANY (')
      expect(sql.values).toContainEqual(['0xcollection'])
    })

    it('should bind LIMIT/OFFSET for pagination', async () => {
      await items.getCatalogItems({ first: 20, skip: 40 }, RATE)

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('LIMIT')
      expect(sql.text).toContain('OFFSET')
      expect(sql.values).toEqual(expect.arrayContaining([20, 40]))
    })
  })
})
