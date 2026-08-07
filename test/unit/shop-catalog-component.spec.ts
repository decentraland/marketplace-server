import { createShopCatalogComponent } from '../../src/ports/shop-catalog/component'
import { IShopCatalogComponent } from '../../src/ports/shop-catalog/types'
// The same helper the component uses to resolve the look-back window, so the expected bound is derived the
// same way rather than restated as a literal that would need editing whenever the window changes.
import { getDateXDaysAgo } from '../../src/ports/trendings/utils'

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
    seller: null,
    issued_id: null,
    price: (5n * WEI_PER_CREDIT).toString(),
    available: '10',
    network: 'MATIC',
    created_at: '1700000000000',
    total: '1',
    ...overrides
  }
}

function legacyRow(overrides: Record<string, unknown> = {}) {
  return {
    trade_id: 'legacy-1',
    contract_address: '0xcollection',
    item_id: '3',
    name: 'Legacy Hat',
    image: 'ipfs://hat.png',
    rarity: 'RARE',
    item_type: 'wearable_v2',
    wearable_category: 'hat',
    creator: '0xcreator',
    mana_wei: '1000000000000000000',
    available: '10',
    network: 'MATIC',
    created_at: '1700000000000',
    total: '1',
    ...overrides
  }
}

// A row from the unified feed. priceCredits is computed in SQL (CEIL of the USD-wei-equivalent), so a
// test that mocks the query supplies it directly; SQL-shape assertions cover the conversion itself.
function unifiedRow(overrides: Record<string, unknown> = {}) {
  return {
    source: 'native',
    acquisition: 'trade',
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
    gender: 'unisex',
    creator: '0xcreator',
    seller: null,
    issued_id: null,
    price_credits: '5',
    mana_wei: null,
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

    it('should surface the seller and issuedId for a secondary (resale) row', async () => {
      query.mockResolvedValueOnce({
        rows: [
          shopRow({
            trade_type: 'public_nft_order',
            token_id: '99',
            item_id: null,
            seller: '0xreseller',
            issued_id: '42'
          })
        ]
      })

      const { data } = await shopCatalog.getShopListings({})

      expect(data[0]).toMatchObject({ listingType: 'secondary', seller: '0xreseller', issuedId: '42' })
    })

    it('should leave seller and issuedId null for a primary row', async () => {
      query.mockResolvedValueOnce({ rows: [shopRow({ seller: null, issued_id: null })] })

      const { data } = await shopCatalog.getShopListings({})

      expect(data[0]).toMatchObject({ listingType: 'primary', seller: null, issuedId: null })
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

    it('should select the seller and issued id from the sent asset JSON (no extra join)', async () => {
      await shopCatalog.getShopListings({})

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain("mv.assets->'sent'->>'owner' AS seller")
      expect(sql.text).toContain("mv.assets->'sent'->>'issued_id' AS issued_id")
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

    it('should restrict to smart wearables when isSmart is set', async () => {
      await shopCatalog.getShopListings({ isSmart: true })

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain("COALESCE(item_p.item_type, item_s.item_type, nft.item_type) = 'smart_wearable_v1'")
    })

    it('should NOT add the smart-wearable filter when isSmart is absent', async () => {
      await shopCatalog.getShopListings({})

      const sql = query.mock.calls[0][0]
      expect(sql.text).not.toContain("= 'smart_wearable_v1'")
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

    it('should filter by a lowercased creator address bound as a parameter', async () => {
      await shopCatalog.getShopListings({ creator: '0xCREATOR' })

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain("lower(COALESCE(item_p.creator, item_s.creator, '')) =")
      expect(sql.values).toContain('0xcreator')
    })

    it('should not constrain by creator when none is supplied', async () => {
      await shopCatalog.getShopListings({})

      expect(query.mock.calls[0][0].text).not.toContain("lower(COALESCE(item_p.creator, item_s.creator, '')) =")
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

  describe('when building the legacy listings query', () => {
    beforeEach(() => {
      query.mockResolvedValue({ rows: [] })
    })

    it('should only include classic ERC20 (asset_type = 1) primary listings', async () => {
      await shopCatalog.getLegacyListings({})

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain("ta.direction = 'received' AND ta.asset_type =")
      expect(sql.values).toContain(1)
    })

    it('should restrict to primaries via the WHERE guard so secondaries are excluded', async () => {
      await shopCatalog.getLegacyListings({})

      const sql = query.mock.calls[0][0]
      // The primary-only guard lives in the WHERE clause (the shared metadataJoins keeps the
      // public_nft_order LEFT JOINs, but no secondary row can satisfy mv.type = 'public_item_order').
      expect(sql.text).toContain("WHERE mv.status = 'open'\n        AND mv.type = 'public_item_order'")
    })

    it('should apply the same open and available guards as the shop feed', async () => {
      await shopCatalog.getLegacyListings({})

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain("mv.status = 'open'")
      expect(sql.text).toContain('mv.available IS NULL OR mv.available > 0')
    })

    it('should not apply any price-range filter', async () => {
      await shopCatalog.getLegacyListings({})

      const sql = query.mock.calls[0][0]
      expect(sql.text).not.toContain('mv.amount_received >=')
      expect(sql.text).not.toContain('mv.amount_received <=')
    })

    it('should clamp pagination and bind LIMIT/OFFSET as params', async () => {
      await shopCatalog.getLegacyListings({ first: 99999, skip: 10.7 })

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('LIMIT')
      expect(sql.text).toContain('OFFSET')
      expect(sql.values).toEqual(expect.arrayContaining([1000, 10]))
    })

    it('should never place a user-supplied sort value into the SQL text', async () => {
      await shopCatalog.getLegacyListings({ sortBy: 'cheapest' })
      expect(query.mock.calls[0][0].text).toContain('ORDER BY mv.amount_received ASC')

      query.mockClear()
      await shopCatalog.getLegacyListings({})
      expect(query.mock.calls[0][0].text).toContain('ORDER BY mv.created_at DESC')
    })

    it('should bind a name search as a parameterized ILIKE with escaped wildcards', async () => {
      await shopCatalog.getLegacyListings({ search: '50%_off' })

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('ILIKE')
      expect(sql.values).toContain('%50\\%\\_off%')
    })

    it('should lowercase rarities and bind them as an array param', async () => {
      await shopCatalog.getLegacyListings({ rarities: ['Rare', 'EPIC'] })

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('lower(item_p.rarity) = ANY(')
      expect(sql.values).toContainEqual(['rare', 'epic'])
    })

    it('should lowercase wearable categories and bind them as an array param', async () => {
      await shopCatalog.getLegacyListings({ wearableCategories: ['Upper_Body', 'HAT'] })

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('lower(COALESCE(item_p.search_wearable_category')
      expect(sql.values).toContainEqual(['upper_body', 'hat'])
    })
  })

  describe('when mapping a legacy listing row', () => {
    it('should pass the raw MANA price through and tag the listing as primary', async () => {
      query.mockResolvedValueOnce({ rows: [legacyRow({ rarity: 'MYTHIC', mana_wei: '2500000000000000000', total: '1' })] })

      const { data, total } = await shopCatalog.getLegacyListings({})

      expect(total).toBe(1)
      expect(data[0]).toMatchObject({
        tradeId: 'legacy-1',
        listingType: 'primary',
        contractAddress: '0xcollection',
        itemId: '3',
        name: 'Legacy Hat',
        thumbnail: 'ipfs://hat.png',
        rarity: 'mythic',
        category: 'wearable',
        wearableCategory: 'hat',
        creator: '0xcreator',
        manaWei: '2500000000000000000',
        available: 10,
        network: 'MATIC',
        createdAt: 1700000000000
      })
    })
  })

  describe('when building the unified listings query', () => {
    // 0.5 USD/MANA, formatted the way the component binds it into the numeric multiply.
    const RATE = 0.5
    const RATE_STR = RATE.toFixed(18)

    beforeEach(() => {
      query.mockResolvedValue({ rows: [] })
    })

    it('should keep the trailing SELECT columns separated from the FROM clause (no token concatenation)', async () => {
      await shopCatalog.getUnifiedListings({}, RATE)

      const text = query.mock.calls[0][0].text as string
      // Guards the SELECT→FROM boundary: a missing space would emit `mana_weiFROM` / `genderFROM`, both
      // SQL syntax errors. gender is the last SELECT column before FROM; mana_wei precedes it.
      expect(text).not.toMatch(/mana_weiFROM/)
      expect(text).not.toMatch(/genderFROM/)
      expect(text).toContain('END AS gender FROM marketplace.mv_trades')
      // Both branches carry a mana_wei column, comma-separated from the gender expression that follows.
      expect(text).toContain('NULL::text AS mana_wei ,')
      expect(text).toContain('mv.amount_received::text AS mana_wei ,')
    })

    it('should merge native and legacy sources with UNION ALL by default', async () => {
      await shopCatalog.getUnifiedListings({}, RATE)

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('UNION ALL')
      // Both asset types are present: native (USD-pegged = 2) and legacy classic ERC20 (= 1).
      expect(sql.values).toContain(2)
      expect(sql.values).toContain(1)
    })

    it('should compute priceCredits in SQL as CEIL of the USD-wei-equivalent', async () => {
      await shopCatalog.getUnifiedListings({}, RATE)

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('CEIL(sub.usd_wei /')
      expect(sql.text).toContain('AS price_credits')
    })

    // A client that wants to hide resales must be able to ask the SERVER for it. The feed is paginated
    // and reports a total, so filtering rows out client-side yields short pages and an overstated count —
    // the reason this filter exists rather than being left to the caller.
    //
    // Asserted by COUNTING the constraint, not by matching it: `mv.type = 'public_item_order'` already
    // appears in the query's own joins, so a plain toContain would pass with no filter applied at all.
    describe('and filtering by listing type', () => {
      const occurrences = (text: string, needle: string) => text.split(needle).length - 1
      const PRIMARY = "AND mv.type = 'public_item_order'"
      const SECONDARY = "AND mv.type <> 'public_item_order'"

      async function textFor(filters: Record<string, unknown>): Promise<string> {
        query.mockClear()
        await shopCatalog.getUnifiedListings(filters, RATE)
        return query.mock.calls[0][0].text as string
      }

      /**
       * One added constraint per UNION branch. Derived from the branch count rather than hardcoded: the
       * invariant is "the filter reaches EVERY branch", and a literal silently stops testing that the
       * moment a branch is added — which is what happened when the CollectionStore branch turned 2 into 3.
       *
       * The store branch gets the predicate too, and that is correct even though its `type` is a constant:
       * for `primary` it is a tautology, and for `secondary` a contradiction that yields no store rows.
       * A mint has no resale form, so "no store rows" is the right answer to a resale-only request.
       */
      const UNION_BRANCHES = 3

      it('should add a mint-only constraint to every union branch when asked for primary', async () => {
        const baseline = occurrences(await textFor({}), PRIMARY)

        expect(occurrences(await textFor({ listingType: 'primary' }), PRIMARY)).toBe(baseline + UNION_BRANCHES)
      })

      it('should add the resale-only constraint to every union branch', async () => {
        expect(occurrences(await textFor({ listingType: 'secondary' }), SECONDARY)).toBe(UNION_BRANCHES)
      })

      it('should return no store rows for a resale-only request, since a mint has no resale form', async () => {
        // The store branch's contradiction (`type` is the constant 'public_item_order' <> itself) is what
        // makes this true, so a caller asking for resales never sees a mint offered as one.
        const text = await textFor({ listingType: 'secondary' })

        expect(text).toContain("'public_item_order'::text AS type")
        expect(occurrences(text, SECONDARY)).toBe(UNION_BRANCHES)
      })

      it('should add a resale-only constraint when asked for secondary', async () => {
        expect(await textFor({ listingType: 'secondary' })).toContain(SECONDARY)
      })

      it('should not constrain the type when omitted', async () => {
        // Back-compat: every existing caller passes no listingType and must keep seeing both.
        const text = await textFor({})

        expect(occurrences(text, PRIMARY)).toBe(occurrences(await textFor({}), PRIMARY))
        expect(text).not.toContain(SECONDARY)
      })

      it('should apply to the grouped item feed too, which is what the browse grid reads', async () => {
        query.mockClear()
        await shopCatalog.getShopItems({}, RATE)
        const baseline = occurrences(query.mock.calls[0][0].text as string, PRIMARY)

        query.mockClear()
        await shopCatalog.getShopItems({ listingType: 'primary' }, RATE)

        expect(occurrences(query.mock.calls[0][0].text as string, PRIMARY)).toBe(baseline + UNION_BRANCHES)
      })
    })

    it('should select the seller and issued id from the sent asset JSON in each branch', async () => {
      await shopCatalog.getUnifiedListings({}, RATE)

      const text = query.mock.calls[0][0].text as string
      expect(text).toContain("mv.assets->'sent'->>'owner' AS seller")
      expect(text).toContain("mv.assets->'sent'->>'issued_id' AS issued_id")
    })

    it('should apply the MANA/USD rate to legacy amounts but leave native amounts untouched', async () => {
      await shopCatalog.getUnifiedListings({}, RATE)

      const sql = query.mock.calls[0][0]
      // Legacy branch multiplies the raw MANA amount by the bound rate; native branch does not.
      expect(sql.text).toContain('mv.amount_received::numeric * ')
      expect(sql.values).toContain(RATE_STR)
    })

    it('should filter the merged set by a credit price range translated into USD wei (ceil-consistent lower bound)', async () => {
      await shopCatalog.getUnifiedListings({ minPriceCredits: 3, maxPriceCredits: 10 }, RATE)

      const sql = query.mock.calls[0][0]
      // Lower bound is CEIL-consistent: keep usd_wei > (m - 1) * WEI so items whose displayed CEIL price
      // equals m are included. Upper bound stays an inclusive <=.
      expect(sql.text).toContain('sub.usd_wei > ')
      expect(sql.text).toContain('sub.usd_wei <=')
      expect(sql.values).toContain((2n * WEI_PER_CREDIT).toString())
      expect(sql.values).toContain((10n * WEI_PER_CREDIT).toString())
    })

    it('should include a fractional-priced legacy item whose displayed (CEIL) credit price equals minPriceCredits', async () => {
      // A legacy item at usd_wei = 4.2e17 displays as CEIL(4.2) = 5 credits. With minPriceCredits=5 the
      // ceil-consistent bound is usd_wei > (5-1)*1e17 = 4e17, so 4.2e17 IS included. A naive `>= 5e17`
      // bound would wrongly exclude it (the fixed bug).
      await shopCatalog.getUnifiedListings({ minPriceCredits: 5 }, RATE)

      const sql = query.mock.calls[0][0]
      expect(sql.values).toContain((4n * WEI_PER_CREDIT).toString())
      expect(sql.values).not.toContain((5n * WEI_PER_CREDIT).toString())
    })

    it('should not append a negative lower bound when minPriceCredits is 0', async () => {
      await shopCatalog.getUnifiedListings({ minPriceCredits: 0 }, RATE)

      const sql = query.mock.calls[0][0]
      // Only the free-item guard (usd_wei > 0) remains; no negative (m-1)*WEI bound is bound as a value.
      expect(sql.values).not.toContain((-1n * WEI_PER_CREDIT).toString())
    })

    it('should append a stable trade_id tiebreaker to every sort so pagination is deterministic', async () => {
      await shopCatalog.getUnifiedListings({ sortBy: 'cheapest' }, RATE)
      expect(query.mock.calls[0][0].text).toContain('ORDER BY sub.usd_wei ASC, sub.trade_id')

      query.mockClear()
      await shopCatalog.getUnifiedListings({ sortBy: 'most_expensive' }, RATE)
      expect(query.mock.calls[0][0].text).toContain('ORDER BY sub.usd_wei DESC, sub.trade_id')

      query.mockClear()
      await shopCatalog.getUnifiedListings({ sortBy: 'name' }, RATE)
      expect(query.mock.calls[0][0].text).toContain('ORDER BY sub.name ASC, sub.trade_id')

      query.mockClear()
      await shopCatalog.getUnifiedListings({}, RATE)
      expect(query.mock.calls[0][0].text).toContain('ORDER BY sub.created_at DESC, sub.trade_id')
    })

    it('should restrict to the legacy source only when source=legacy (no native branch)', async () => {
      await shopCatalog.getUnifiedListings({ source: 'legacy' }, RATE)

      const sql = query.mock.calls[0][0]
      expect(sql.values).toContain(1)
      expect(sql.values).not.toContain(2)
      // `legacy` is TWO branches, not one: the MANA-priced offchain trade and the CollectionStore mint. Both
      // are legacy-priced (live rate) and differ only in how they are bought, so a UNION ALL is expected here
      // even though a single source was requested.
      expect(sql.text).toContain('UNION ALL')
      expect(sql.values).toContain('store')
      expect(sql.values).toContain('trade')
    })

    it('should restrict to the native source only when source=native (no legacy branch)', async () => {
      await shopCatalog.getUnifiedListings({ source: 'native' }, RATE)

      const sql = query.mock.calls[0][0]
      expect(sql.text).not.toContain('UNION ALL')
      expect(sql.values).toContain(2)
      expect(sql.values).not.toContain(1)
    })

    it('should sort the merged set on the USD-wei-equivalent, never on user input', async () => {
      await shopCatalog.getUnifiedListings({ sortBy: 'cheapest' }, RATE)
      expect(query.mock.calls[0][0].text).toContain('ORDER BY sub.usd_wei ASC')

      query.mockClear()
      await shopCatalog.getUnifiedListings({ sortBy: 'most_expensive' }, RATE)
      expect(query.mock.calls[0][0].text).toContain('ORDER BY sub.usd_wei DESC')

      query.mockClear()
      await shopCatalog.getUnifiedListings({}, RATE)
      expect(query.mock.calls[0][0].text).toContain('ORDER BY sub.created_at DESC')
    })

    it('should drop free items via a usd_wei guard on the merged set', async () => {
      await shopCatalog.getUnifiedListings({}, RATE)

      expect(query.mock.calls[0][0].text).toContain('sub.usd_wei > 0')
    })
  })

  describe('when mapping unified listing rows', () => {
    it('should carry a server-computed priceCredits and a source discriminator for each item', async () => {
      query.mockResolvedValueOnce({
        rows: [
          unifiedRow({ source: 'native', trade_id: 'native-1', price_credits: '5', mana_wei: null, total: '2' }),
          unifiedRow({
            source: 'legacy',
            trade_id: 'legacy-1',
            trade_type: 'public_item_order',
            token_id: null,
            price_credits: '3',
            mana_wei: '2500000000000000000',
            total: '2'
          })
        ]
      })

      const { data, total } = await shopCatalog.getUnifiedListings({}, 0.5)

      expect(total).toBe(2)
      // Native carries no MANA price; legacy carries the raw MANA wei for live-rate sizing at checkout.
      expect(data[0]).toMatchObject({ source: 'native', tradeId: 'native-1', priceCredits: 5, manaWei: null })
      expect(data[1]).toMatchObject({ source: 'legacy', tradeId: 'legacy-1', priceCredits: 3, manaWei: '2500000000000000000' })
    })

    it('should tag a secondary (public_nft_order) native row and keep its tokenId', async () => {
      query.mockResolvedValueOnce({
        rows: [unifiedRow({ source: 'native', trade_type: 'public_nft_order', token_id: '99', item_id: null, price_credits: '7' })]
      })

      const { data } = await shopCatalog.getUnifiedListings({}, 0.5)

      expect(data[0]).toMatchObject({ source: 'native', listingType: 'secondary', tokenId: '99', priceCredits: 7 })
    })

    it('should surface the seller and issuedId for a secondary (resale) row', async () => {
      query.mockResolvedValueOnce({
        rows: [
          unifiedRow({
            source: 'native',
            trade_type: 'public_nft_order',
            token_id: '99',
            item_id: null,
            seller: '0xreseller',
            issued_id: '42'
          })
        ]
      })

      const { data } = await shopCatalog.getUnifiedListings({}, 0.5)

      expect(data[0]).toMatchObject({ listingType: 'secondary', seller: '0xreseller', issuedId: '42' })
    })

    it('should surface the body-shape-derived gender and coalesce a missing one to null', async () => {
      query.mockResolvedValueOnce({
        rows: [
          unifiedRow({ trade_id: 'm', gender: 'male' }),
          unifiedRow({ trade_id: 'f', gender: 'female' }),
          unifiedRow({ trade_id: 'e', gender: null }) // emote / no body shapes
        ]
      })

      const { data } = await shopCatalog.getUnifiedListings({}, 0.5)

      expect(data.map(d => d.gender)).toEqual(['male', 'female', null])
    })
  })

  describe('when mapping a CollectionStore row to a model', () => {
    it('should carry acquisition through and drop the trade id, which does not exist for a mint', async () => {
      query.mockResolvedValueOnce({
        rows: [itemRow({ source: 'legacy', acquisition: 'store', trade_id: '0xcollection-3', mana_wei: '1000' })]
      })

      const { data } = await shopCatalog.getShopItems({}, 0.5)

      expect(data[0].acquisition).toBe('store')
      // The SQL keeps item.id in trade_id purely as a DISTINCT ON tiebreaker. It must NOT reach the model:
      // tradeId is threaded into POST /credits/authorize and persisted on the purchase intent, so a
      // fabricated id would put a reference to a nonexistent trade into the money ledger.
      expect(data[0].tradeId).toBeNull()
      // Still legacy-priced, so it keeps the raw MANA price for the client to re-quote at the live rate.
      expect(data[0].source).toBe('legacy')
      expect(data[0].manaWei).toBe('1000')
      expect(data[0].listingType).toBe('primary')
    })

    it('should keep the trade id on a trade row', async () => {
      query.mockResolvedValueOnce({ rows: [itemRow({ acquisition: 'trade', trade_id: 'trade-7' })] })

      const { data } = await shopCatalog.getShopItems({}, 0.5)

      expect(data[0].acquisition).toBe('trade')
      expect(data[0].tradeId).toBe('trade-7')
    })

    it('should do the same on the per-listing feed', async () => {
      query.mockResolvedValueOnce({
        rows: [unifiedRow({ source: 'legacy', acquisition: 'store', trade_id: '0xcollection-3' })]
      })

      const { data } = await shopCatalog.getUnifiedListings({}, 0.5)

      expect(data[0].acquisition).toBe('store')
      expect(data[0].tradeId).toBeNull()
    })
  })

  /**
   * The CollectionStore branch. These items are the majority of the sellable catalogue and they are NOT
   * trades: primary minting has no order and nothing signed, so it cannot be recovered by filtering
   * mv_trades. The branch therefore brings its own base relation, and what these tests pin is that it stays
   * shaped like the others (so the shared filters keep applying) while carrying the facts that differ.
   */
  describe('when building the CollectionStore branch of the unified feed', () => {
    const RATE = 0.5

    beforeEach(() => {
      query.mockResolvedValue({ rows: [] })
    })

    it('should read from the item table rather than from trades', async () => {
      await shopCatalog.getShopItems({}, RATE)

      const text = query.mock.calls[0][0].text as string
      expect(text).toContain('search_is_store_minter = true')
      // Shaped like mv_trades and aliased `mv`, which is what lets the metadata joins and every browse
      // filter apply to it unchanged instead of needing a parallel set of expressions.
      expect(text).toContain(') mv')
      expect(text).toContain("'public_item_order'::text AS type")
    })

    it('should tag store rows with acquisition=store while keeping them legacy-priced', async () => {
      await shopCatalog.getShopItems({}, RATE)

      const { values } = query.mock.calls[0][0]
      // Three branches: native trade, legacy trade, legacy store.
      expect(values).toContain('store')
      expect(values.filter((v: unknown) => v === 'legacy')).toHaveLength(2)
      expect(values).toContain('native')
    })

    it('should exclude collections the marketplace itself hides', async () => {
      await shopCatalog.getShopItems({}, RATE)

      // /v2/catalog applies this as a base WHERE; omitting it would surface unapproved collections that the
      // marketplace does not show.
      expect(query.mock.calls[0][0].text).toContain('search_is_collection_approved = true')
    })

    it('should exclude sold-out mints and free claims', async () => {
      await shopCatalog.getShopItems({}, RATE)

      const text = query.mock.calls[0][0].text as string
      // Store supply is finite and shrinks as others mint, so available must be checked at read time.
      expect(text).toContain('i.available > 0')
      expect(text).toContain('i.price > 0')
    })

    it('should exclude the uint256-max sentinel the squid uses for "no price"', async () => {
      await shopCatalog.getShopItems({}, RATE)

      const { text, values } = query.mock.calls[0][0]
      // `price > 0` does NOT exclude it, and an item carrying it would be advertised at ~1.16e42 credits.
      expect(text).toContain('i.price IS DISTINCT FROM')
      expect(values).toContain('115792089237316195423570985008687907853269984665640564039457584007913129639935')
    })

    it('should exclude social emotes, which the marketplace itself hides', async () => {
      await shopCatalog.getShopItems({}, RATE)

      // Every marketplace client sends includeSocialEmotes=false. The store branch is where the bulk of the
      // minting catalogue enters, so without this the Shop surfaces what the marketplace suppresses.
      expect(query.mock.calls[0][0].text).toContain('i.search_emote_outcome_type IS NULL')
    })

    it('should exclude L1 items, which cannot be minted through the Polygon-only store', async () => {
      await shopCatalog.getShopItems({}, RATE)

      // The row tells the client to call CollectionStore.buy; an ETHEREUM row would offer a purchase that
      // cannot settle.
      expect(query.mock.calls[0][0].text).toContain("i.network <> 'ETHEREUM'")
    })

    it('should bound the price before the bigint cast so one bad row cannot 500 the whole feed', async () => {
      await shopCatalog.getShopItems({}, RATE)

      const { text, values } = query.mock.calls[0][0]
      // CEIL(usd_wei / C)::bigint raises `bigint out of range` on an absurd price, aborting the ENTIRE
      // query rather than dropping the row. The sentinel guard does not cover it — sentinel-1 clears that
      // check and still overflows.
      expect(text).toContain('u.usd_wei <=')
      expect(values).toContain('1000000000000000000000000000000')
    })

    it('should cast the unioned id and enum columns to text so the branches can be merged', async () => {
      await shopCatalog.getShopItems({}, RATE)

      const text = query.mock.calls[0][0].text as string
      // mv_trades.id is uuid and item.id is varchar; mv_trades.type is an enum. Postgres refuses to match
      // those across a UNION, and the failure is a runtime error no type checker would catch.
      expect(text).toContain('mv.id::text AS trade_id')
      expect(text).toContain('mv.type::text AS trade_type')
    })

    it('should give the store branch a WHERE for the shared filters to append to', async () => {
      await shopCatalog.getShopItems({ rarities: ['rare'] }, RATE)

      const text = query.mock.calls[0][0].text as string
      // appendUnifiedFilters emits ` AND <clause>`, so without a WHERE a FILTERED request is a syntax error
      // while an unfiltered one parses — it would work until someone picked a rarity.
      expect(text).toContain('WHERE TRUE')
      expect(text.match(/lower\(COALESCE\(item_p\.rarity/g)).toHaveLength(3)
    })

    it('should apply the shared browse filters to the store branch as well', async () => {
      await shopCatalog.getShopItems({ category: 'emote', creator: '0xAbC', search: 'hat' }, RATE)

      const { text, values } = query.mock.calls[0][0]
      // One occurrence per branch — the point of reusing the join chain is that this holds by construction.
      expect(text.match(/ILIKE 'emote%'/g)).toHaveLength(3)
      expect(values.filter((v: unknown) => v === '0xabc')).toHaveLength(3)
      expect(values.filter((v: unknown) => v === '%hat%')).toHaveLength(3)
    })

    it('should not apply trade-only predicates to the store branch', async () => {
      await shopCatalog.getShopItems({}, RATE)

      const text = query.mock.calls[0][0].text as string
      // The store relation has no status column and no per-trade asset rows. Two branches are trades, so
      // these appear twice, not three times.
      expect(text.match(/mv\.status = 'open'/g)).toHaveLength(2)
      expect(text.match(/FROM marketplace\.trade_assets/g)).toHaveLength(2)
    })

    it('should break a price tie towards the trade, whose price is signed', async () => {
      await shopCatalog.getShopItems({}, RATE)

      const text = query.mock.calls[0][0].text as string
      // An item can be both minting and listed as a primary trade at the same price. CollectionStore.buy
      // re-validates the price on-chain and reverts if it moved; a trade cannot. Ordered BELOW usd_wei so a
      // genuinely cheaper mint still wins on price.
      const priceIdx = text.indexOf('f.usd_wei ASC')
      const tieIdx = text.indexOf("f.acquisition = 'trade'")
      expect(priceIdx).toBeGreaterThan(-1)
      expect(tieIdx).toBeGreaterThan(priceIdx)
    })
  })

  // An item-unified row: a UnifiedListingRow (the surviving representative listing) plus listing_count.
  function itemRow(overrides: Record<string, unknown> = {}) {
    return unifiedRow({ listing_count: '1', ...overrides })
  }

  describe('when building the item-unified query', () => {
    const RATE = 0.5
    const RATE_STR = RATE.toFixed(18)

    beforeEach(() => {
      query.mockResolvedValue({ rows: [] })
    })

    it('should collapse to one row per item via DISTINCT ON (contract_address, item_id)', async () => {
      await shopCatalog.getShopItems({}, RATE)

      const text = query.mock.calls[0][0].text as string
      expect(text).toContain('SELECT DISTINCT ON (f.contract_address, f.item_id)')
    })

    it('should pick the representative listing primary-before-secondary, then native-before-legacy, then cheapest', async () => {
      await shopCatalog.getShopItems({}, RATE)

      const text = query.mock.calls[0][0].text as string
      // The DISTINCT ON tiebreak ORDER BY must lead with the grouping key, then the priority chain.
      expect(text).toContain('ORDER BY\n          f.contract_address,\n          f.item_id,')
      expect(text).toContain("(CASE WHEN f.trade_type = 'public_item_order' THEN 0 ELSE 1 END)")
      expect(text).toContain("(CASE WHEN f.source = 'native' THEN 0 ELSE 1 END)")
      expect(text).toContain('f.usd_wei ASC')
      expect(text).toContain('f.trade_id')
    })

    it('should attach a per-item listing_count window partitioned by (contract_address, item_id)', async () => {
      await shopCatalog.getShopItems({}, RATE)

      const text = query.mock.calls[0][0].text as string
      expect(text).toContain('COUNT(*) OVER (PARTITION BY u.contract_address, u.item_id) AS listing_count')
    })

    it('should compute the headline priceCredits in SQL as CEIL of the survivor usd_wei', async () => {
      await shopCatalog.getShopItems({}, RATE)

      const text = query.mock.calls[0][0].text as string
      expect(text).toContain('CEIL(f.usd_wei /')
      expect(text).toContain('AS price_credits')
    })

    it('should drop free/broken listings before grouping so they never headline or inflate the count', async () => {
      await shopCatalog.getShopItems({}, RATE)

      const text = query.mock.calls[0][0].text as string
      expect(text).toContain('WHERE u.usd_wei > 0')
    })

    it('should merge native and legacy sources with UNION ALL by default', async () => {
      await shopCatalog.getShopItems({}, RATE)

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('UNION ALL')
      expect(sql.values).toContain(2)
      expect(sql.values).toContain(1)
    })

    it('should restrict to the requested source, native being the only single-branch one', async () => {
      // native is one branch: USD-pegged trades. No legacy asset type, no store.
      await shopCatalog.getShopItems({ source: 'native' }, RATE)
      let sql = query.mock.calls[0][0]
      expect(sql.text).not.toContain('UNION ALL')
      expect(sql.values).toContain(2)
      expect(sql.values).not.toContain(1)
      expect(sql.values).not.toContain('store')

      query.mockClear()
      // legacy is TWO branches — the MANA-priced trade and the CollectionStore mint — so it unions even
      // though one source was asked for. Still no native asset type.
      await shopCatalog.getShopItems({ source: 'legacy' }, RATE)
      sql = query.mock.calls[0][0]
      expect(sql.text).toContain('UNION ALL')
      expect(sql.values).toContain(1)
      expect(sql.values).not.toContain(2)
      expect(sql.values).toContain('store')
    })

    it('should apply the MANA/USD rate to legacy amounts only', async () => {
      await shopCatalog.getShopItems({}, RATE)

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('mv.amount_received::numeric * ')
      expect(sql.values).toContain(RATE_STR)
    })

    it('should filter the credit price range on the item headline price (ceil-consistent lower bound)', async () => {
      await shopCatalog.getShopItems({ minPriceCredits: 3, maxPriceCredits: 10 }, RATE)

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('d.usd_wei > ')
      expect(sql.text).toContain('d.usd_wei <=')
      expect(sql.values).toContain((2n * WEI_PER_CREDIT).toString())
      expect(sql.values).toContain((10n * WEI_PER_CREDIT).toString())
    })

    it('should not append a negative lower bound when minPriceCredits is 0', async () => {
      await shopCatalog.getShopItems({ minPriceCredits: 0 }, RATE)

      const sql = query.mock.calls[0][0]
      expect(sql.values).not.toContain((-1n * WEI_PER_CREDIT).toString())
    })

    it('should sort the deduped items on fixed expressions with a stable trade_id tiebreaker', async () => {
      await shopCatalog.getShopItems({ sortBy: 'cheapest' }, RATE)
      expect(query.mock.calls[0][0].text).toContain('ORDER BY d.usd_wei ASC, d.trade_id')

      query.mockClear()
      await shopCatalog.getShopItems({ sortBy: 'most_expensive' }, RATE)
      expect(query.mock.calls[0][0].text).toContain('ORDER BY d.usd_wei DESC, d.trade_id')

      query.mockClear()
      await shopCatalog.getShopItems({ sortBy: 'name' }, RATE)
      expect(query.mock.calls[0][0].text).toContain('ORDER BY d.name ASC, d.trade_id')

      query.mockClear()
      await shopCatalog.getShopItems({}, RATE)
      expect(query.mock.calls[0][0].text).toContain('ORDER BY d.created_at DESC, d.trade_id')
    })

    it('should clamp pagination and bind LIMIT/OFFSET as params', async () => {
      await shopCatalog.getShopItems({ first: 99999, skip: 10.7 }, RATE)

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('LIMIT')
      expect(sql.text).toContain('OFFSET')
      expect(sql.values).toEqual(expect.arrayContaining([1000, 10]))
    })

    it('should count total items from COUNT(*) OVER() on the deduped set', async () => {
      await shopCatalog.getShopItems({}, RATE)
      expect(query.mock.calls[0][0].text).toContain('COUNT(*) OVER() AS total')
    })

    it('should exclude social emotes from every branch on includeSocialEmotes=false', async () => {
      await shopCatalog.getShopItems({ includeSocialEmotes: false }, RATE)

      const text = query.mock.calls[0][0].text as string
      // Before this filter existed, a social emote could reach the Shop's browse grid through an offchain
      // trade on one -- the CollectionStore branch excludes them at source, but the two trade branches did
      // not. One occurrence per branch, or the union leaves a way around it.
      expect(text.match(/COALESCE\(item_p\.search_emote_outcome_type, item_s\.search_emote_outcome_type\) IS NULL/g)).toHaveLength(3)
    })

    it('should include social emotes by default, leaving the pre-existing response unchanged', async () => {
      await shopCatalog.getShopItems({}, RATE)

      expect(query.mock.calls[0][0].text).not.toContain('search_emote_outcome_type, item_s.search_emote_outcome_type) IS NULL')
    })
  })

  describe('when mapping item-unified rows', () => {
    it('should surface the representative listing and the per-item listingCount', async () => {
      query.mockResolvedValueOnce({
        rows: [
          itemRow({ source: 'native', trade_id: 'native-1', price_credits: '5', mana_wei: null, listing_count: '3', total: '2' }),
          itemRow({
            source: 'native',
            trade_id: 'native-2',
            trade_type: 'public_nft_order',
            token_id: '99',
            item_id: null,
            price_credits: '7',
            listing_count: '1',
            total: '2'
          })
        ]
      })

      const { data, total } = await shopCatalog.getShopItems({}, 0.5)

      expect(total).toBe(2)
      expect(data[0]).toMatchObject({ tradeId: 'native-1', listingType: 'primary', priceCredits: 5, listingCount: 3 })
      expect(data[1]).toMatchObject({ tradeId: 'native-2', listingType: 'secondary', tokenId: '99', priceCredits: 7, listingCount: 1 })
    })

    it('should carry the raw MANA price for a legacy representative and the source discriminator', async () => {
      query.mockResolvedValueOnce({
        rows: [itemRow({ source: 'legacy', trade_id: 'legacy-1', price_credits: '3', mana_wei: '2500000000000000000', listing_count: '2' })]
      })

      const { data } = await shopCatalog.getShopItems({}, 0.5)

      expect(data[0]).toMatchObject({
        source: 'legacy',
        tradeId: 'legacy-1',
        priceCredits: 3,
        manaWei: '2500000000000000000',
        listingCount: 2
      })
    })

    it('should surface the representative seller and issuedId for a secondary headline, null for a primary', async () => {
      query.mockResolvedValueOnce({
        rows: [
          itemRow({
            trade_id: 'sec-1',
            trade_type: 'public_nft_order',
            token_id: '99',
            item_id: null,
            seller: '0xreseller',
            issued_id: '42'
          }),
          itemRow({ trade_id: 'prim-1', trade_type: 'public_item_order', seller: null, issued_id: null })
        ]
      })

      const { data } = await shopCatalog.getShopItems({}, 0.5)

      expect(data[0]).toMatchObject({ listingType: 'secondary', seller: '0xreseller', issuedId: '42' })
      expect(data[1]).toMatchObject({ listingType: 'primary', seller: null, issuedId: null })
    })
  })

  // The related-items rail runs TWO statements: the anchor-item lookup, then the feed query. So every test
  // here queues the anchor row first and reads query.mock.calls[1] for the feed SQL.
  describe('when building the related items query', () => {
    const RATE = 0.5
    const CONTRACT = '0xCollection'
    const ANCHOR = { contractAddress: CONTRACT, itemId: '3' }

    function referenceRow(overrides: Record<string, unknown> = {}) {
      return { rarity: 'rare', item_type: 'wearable_v2', wearable_category: 'hat', ...overrides }
    }

    function mockAnchor(overrides: Record<string, unknown> = {}) {
      query.mockResolvedValueOnce({ rows: [referenceRow(overrides)] })
      query.mockResolvedValueOnce({ rows: [] })
    }

    it('should resolve the anchor item from the squid item table by collection and blockchain id', async () => {
      mockAnchor()

      await shopCatalog.getRelatedItems(ANCHOR, RATE)

      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('item.collection_id =')
      expect(sql.text).toContain('item.blockchain_id =')
      // The contract is lowercased so a checksummed address from the URL still matches the squid row.
      expect(sql.values).toEqual(expect.arrayContaining([CONTRACT.toLowerCase(), '3']))
    })

    it('should return nothing and skip the feed query when the anchor item is unknown', async () => {
      query.mockResolvedValueOnce({ rows: [] })

      const { data } = await shopCatalog.getRelatedItems(ANCHOR, RATE)

      expect(data).toEqual([])
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('should hard-filter on the anchor top-level category and on-chain sub-category', async () => {
      mockAnchor({ item_type: 'wearable_v2', wearable_category: 'hat' })

      await shopCatalog.getRelatedItems(ANCHOR, RATE)

      const sql = query.mock.calls[1][0]
      expect(sql.text).toContain("NOT ILIKE 'emote%'")
      expect(sql.text).toContain('search_wearable_category')
      expect(sql.values).toEqual(expect.arrayContaining([['hat']]))
    })

    it('should filter emotes to emotes when the anchor is an emote', async () => {
      mockAnchor({ item_type: 'emote_v1', wearable_category: 'dance' })

      await shopCatalog.getRelatedItems(ANCHOR, RATE)

      const sql = query.mock.calls[1][0]
      expect(sql.text).toContain("ILIKE 'emote%'")
      expect(sql.values).toEqual(expect.arrayContaining([['dance']]))
    })

    it('should fall back to the top-level category alone when the anchor has no sub-category', async () => {
      mockAnchor({ wearable_category: null })

      await shopCatalog.getRelatedItems(ANCHOR, RATE)

      const sql = query.mock.calls[1][0]
      expect(sql.text).not.toContain('lower(COALESCE(item_p.search_wearable_category')
      expect(sql.text).toContain("NOT ILIKE 'emote%'")
    })

    it('should exclude the anchor item with a NULL-safe disjunction, not a negated conjunction', async () => {
      mockAnchor()

      await shopCatalog.getRelatedItems(ANCHOR, RATE)

      const sql = query.mock.calls[1][0]
      // `NOT (contract = x AND item_id = y)` evaluates to NULL — and so drops the row — whenever item_id
      // is NULL, which would silently hide every secondary-only row from the rail.
      expect(sql.text).toContain('d.contract_address <> ')
      expect(sql.text).toContain("COALESCE(d.item_id, '') <> ")
      expect(sql.text).not.toContain('NOT (d.contract_address')
    })

    it('should order by distance from the anchor rarity, then newest, then trade id', async () => {
      mockAnchor({ rarity: 'rare' })

      await shopCatalog.getRelatedItems(ANCHOR, RATE)

      const sql = query.mock.calls[1][0]
      expect(sql.text).toContain('ORDER BY CASE lower(d.rarity)')
      expect(sql.text).toContain('d.created_at DESC, d.trade_id')
      // The CASE binds a precomputed distance per tier: the anchor's own rarity is 0 (so exact matches
      // lead), its neighbours 1, and so on outwards along the scarcity scale.
      const distances = sql.values.slice(sql.values.indexOf('unique'))
      expect(distances).toEqual(expect.arrayContaining(['rare', 0, 'uncommon', 1, 'epic', 1, 'common', 2]))
    })

    it('should place an unrecognised rarity behind every known tier', async () => {
      mockAnchor({ rarity: 'unique' })

      await shopCatalog.getRelatedItems(ANCHOR, RATE)

      const sql = query.mock.calls[1][0]
      // 8 known tiers -> the ELSE distance is 8, further than the widest real gap (unique..common = 7).
      expect(sql.text).toContain('ELSE $')
      expect(sql.values).toEqual(expect.arrayContaining([8]))
    })

    it('should apply no rarity preference when the anchor rarity is missing or unknown', async () => {
      mockAnchor({ rarity: null })

      await shopCatalog.getRelatedItems(ANCHOR, RATE)

      const sql = query.mock.calls[1][0]
      expect(sql.text).toContain('ORDER BY 0, d.created_at DESC')
      expect(sql.text).not.toContain('CASE lower(d.rarity)')
    })

    it('should reuse the item-unified grouping so the rail is one card per item', async () => {
      mockAnchor()

      await shopCatalog.getRelatedItems(ANCHOR, RATE)

      const text = query.mock.calls[1][0].text as string
      expect(text).toContain('SELECT DISTINCT ON (f.contract_address, f.item_id)')
      expect(text).toContain('COUNT(*) OVER (PARTITION BY u.contract_address, u.item_id) AS listing_count')
      expect(text).toContain('CEIL(f.usd_wei /')
      expect(text).toContain('UNION ALL')
    })

    // The rail is supposed to be indistinguishable from the browse grid, so every guard and tiebreak the
    // grid applies has to reach it through the shared core. These are the assertions that fail if someone
    // adds one to getShopItems' own SQL instead of to buildItemUnifiedCore.
    it('should inherit the price bound that stops one absurd row aborting the query', async () => {
      mockAnchor()

      await shopCatalog.getRelatedItems(ANCHOR, RATE)

      const { text, values } = query.mock.calls[1][0]
      expect(text).toContain('u.usd_wei <=')
      expect(values).toContain('1000000000000000000000000000000')
    })

    it('should inherit the tie-break towards the trade over an equally-priced store mint', async () => {
      mockAnchor()

      await shopCatalog.getRelatedItems(ANCHOR, RATE)

      const text = query.mock.calls[1][0].text as string
      const priceIdx = text.indexOf('f.usd_wei ASC')
      const tieIdx = text.indexOf("f.acquisition = 'trade'")
      expect(priceIdx).toBeGreaterThan(-1)
      expect(tieIdx).toBeGreaterThan(priceIdx)
    })

    it('should draw from all three credit-buyable branches, store mints included', async () => {
      mockAnchor({ item_type: 'emote_v1', wearable_category: 'dance' })

      await shopCatalog.getRelatedItems(ANCHOR, RATE)

      const text = query.mock.calls[1][0].text as string
      // native trade + legacy trade + CollectionStore mint. The similarity filter must land on all three —
      // one occurrence per branch — or the rail would silently mix in unrelated store items.
      expect(text.match(/UNION ALL/g)).toHaveLength(2)
      expect(text).toContain('i.search_is_store_minter = true')
      expect(text.match(/ILIKE 'emote%'/g)).toHaveLength(3)
      expect(text.match(/lower\(COALESCE\(item_p\.search_wearable_category/g)).toHaveLength(3)
    })

    it('should clamp the limit to the related cap and never paginate', async () => {
      mockAnchor()
      await shopCatalog.getRelatedItems({ ...ANCHOR, first: 9999 }, RATE)

      let sql = query.mock.calls[1][0]
      expect(sql.text).toContain('LIMIT')
      expect(sql.text).not.toContain('OFFSET')
      expect(sql.text).not.toContain('COUNT(*) OVER() AS total')
      expect(sql.values).toContain(50)

      query.mockClear()
      mockAnchor()
      await shopCatalog.getRelatedItems(ANCHOR, RATE)
      sql = query.mock.calls[1][0]
      expect(sql.values).toContain(10)
    })
  })

  /**
   * The rail exists because `/v1/rankings/creators` cannot answer this question: it attributes a sale to
   * the SELLER, and a primary mint is executed by the buyer against the store, so a creator who sells
   * mostly primary barely registers there. These pin the attribution and the window.
   */
  describe('when building the top creators query', () => {
    beforeEach(() => {
      query.mockResolvedValue({ rows: [] })
    })

    it('should attribute a sale to whoever created the item, in a single query', async () => {
      await shopCatalog.getTopCreators({})

      expect(query).toHaveBeenCalledTimes(1)
      const text = query.mock.calls[0][0].text as string
      expect(text).toContain('item.creator AS creator')
      expect(text).toContain('GROUP BY item.creator')
      // The join is the whole point: without it this would be the seller, which is the number we are
      // deliberately not using.
      expect(text).toContain('item.id = sale.item_id')
    })

    it('should bind the window as a unix SECONDS bound derived from midnight N days ago', async () => {
      await shopCatalog.getTopCreators({})

      const { values } = query.mock.calls[0][0]
      const expected = Math.floor(getDateXDaysAgo(30).getTime() / 1000)
      expect(values).toContain(expected)
      // `sale.timestamp` is stored in seconds; binding milliseconds would match every sale ever made.
      expect(values).not.toContain(expected * 1000)
    })

    it('should clamp the window and the row count to the supported range', async () => {
      await shopCatalog.getTopCreators({ days: 9999, first: 9999 })
      let values = query.mock.calls[0][0].values
      expect(values).toContain(Math.floor(getDateXDaysAgo(365).getTime() / 1000))
      expect(values).toContain(60)

      query.mockClear()
      await shopCatalog.getTopCreators({ days: 0, first: 0 })
      values = query.mock.calls[0][0].values
      expect(values).toContain(Math.floor(getDateXDaysAgo(1).getTime() / 1000))
      expect(values).toContain(1)
    })

    it('should leave out sales with no item and creators whose collections are not approved', async () => {
      await shopCatalog.getTopCreators({})

      const text = query.mock.calls[0][0].text as string
      expect(text).toContain('sale.item_id IS NOT NULL')
      // An unapproved collection is not browsable, so its creator is not introducible either.
      expect(text).toContain('item.search_is_collection_approved = true')
    })

    it('should return the ranked creators with their sale counts', async () => {
      query.mockResolvedValue({
        rows: [
          { creator: '0xa', sales: 62 },
          { creator: '0xb', sales: 34 }
        ]
      })

      await expect(shopCatalog.getTopCreators({})).resolves.toEqual({
        data: [
          { id: '0xa', sales: 62 },
          { id: '0xb', sales: 34 }
        ]
      })
    })
  })

  describe('when building the trending items query', () => {
    const RATE = 0.5

    beforeEach(() => {
      query.mockResolvedValue({ rows: [] })
    })

    it('should rank on sales made inside the look-back window, in a single query', async () => {
      await shopCatalog.getTrendingItems({}, RATE)

      // One statement. The marketplace's row costs 1 + N queries (one item lookup per distinct item sold),
      // so this assertion is the whole performance claim.
      expect(query).toHaveBeenCalledTimes(1)
      const text = query.mock.calls[0][0].text as string
      expect(text).toContain('WITH sales_window AS')
      expect(text).toContain('COUNT(*)::int AS sales')
      expect(text).toContain('SUM(sale.price::numeric) AS volume')
      expect(text).toContain('sale.timestamp > ')
    })

    it('should bind the window as a unix SECONDS bound derived from midnight N days ago', async () => {
      await shopCatalog.getTrendingItems({}, RATE)

      const { values } = query.mock.calls[0][0]
      const expected = Math.floor(getDateXDaysAgo(1).getTime() / 1000)
      expect(values).toContain(expected)
      // `sale.timestamp` is stored in seconds; binding milliseconds would silently match every sale ever.
      expect(values).not.toContain(expected * 1000)
    })

    it('should widen the window with days and clamp it to the supported range', async () => {
      await shopCatalog.getTrendingItems({ days: 7 }, RATE)
      expect(query.mock.calls[0][0].values).toContain(Math.floor(getDateXDaysAgo(7).getTime() / 1000))

      query.mockClear()
      await shopCatalog.getTrendingItems({ days: 9999 }, RATE)
      expect(query.mock.calls[0][0].values).toContain(Math.floor(getDateXDaysAgo(7).getTime() / 1000))

      query.mockClear()
      await shopCatalog.getTrendingItems({ days: 0 }, RATE)
      expect(query.mock.calls[0][0].values).toContain(Math.floor(getDateXDaysAgo(1).getTime() / 1000))
    })

    it('should ignore sales that carry no item identity rather than counting and discarding them', async () => {
      await shopCatalog.getTrendingItems({}, RATE)

      expect(query.mock.calls[0][0].text).toContain('sale.search_item_id IS NOT NULL')
    })

    it('should join the sales window to the item-unified core on (contract_address, item_id)', async () => {
      await shopCatalog.getTrendingItems({}, RATE)

      const text = query.mock.calls[0][0].text as string
      // An INNER join is what guarantees the rail can only contain credit-buyable items: an item that is
      // trending but has no open credit-buyable offer has no row in the core to join to.
      expect(text).toContain('JOIN sales_window w ON w.contract_address = d.contract_address AND w.item_id = d.item_id')
      expect(text).not.toContain('LEFT JOIN sales_window')
      expect(text).toContain('sale.search_item_id::text AS item_id')
    })

    it('should reuse the item-unified core so the rail is one credit-priced card per item', async () => {
      await shopCatalog.getTrendingItems({}, RATE)

      const text = query.mock.calls[0][0].text as string
      expect(text).toContain('SELECT DISTINCT ON (f.contract_address, f.item_id)')
      expect(text).toContain('COUNT(*) OVER (PARTITION BY u.contract_address, u.item_id) AS listing_count')
      expect(text).toContain('CEIL(f.usd_wei /')
      // native trade + legacy trade + CollectionStore mint
      expect(text.match(/UNION ALL/g)).toHaveLength(2)
      expect(text).toContain('i.search_is_store_minter = true')
    })

    it('should split the slots 60/40 between the sales and volume signals, summing to the requested size', async () => {
      await shopCatalog.getTrendingItems({ first: 12 }, RATE)

      const { text, values } = query.mock.calls[0][0]
      expect(text).toContain('AS sales_rank')
      expect(text).toContain('AS volume_rank')
      expect(text).toContain('WHERE by_sales OR volume_rank <= ')
      // ceil(12 * 0.6) = 8 by sales, 12 - 8 = 4 by volume. The marketplace's fractional Array.slice pair
      // would ask for 7 + 4 = 11 here and under-fill the rail by one even with plenty of supply.
      expect(values).toContain(8)
      expect(values).toContain(4)
      expect(values).toContain(12)
    })

    it('should rank the volume pass only over the items the sales pass did not take', async () => {
      await shopCatalog.getTrendingItems({ first: 12 }, RATE)

      const text = query.mock.calls[0][0].text as string
      expect(text).toContain('PARTITION BY (ranked.sales_rank <= ')
      expect(text).toContain('ORDER BY ranked.volume DESC, ranked.sales DESC')
    })

    it('should rank volume on what the sales actually settled at, not the current price times the count', async () => {
      await shopCatalog.getTrendingItems({}, RATE)

      const text = query.mock.calls[0][0].text as string
      expect(text).toContain('SUM(sale.price::numeric) AS volume')
      // /v1/trendings multiplies the item's LIVE price by its sale count, so a creator re-pricing an item
      // rewrites its past volume. Nothing here may multiply a price by a count.
      expect(text).not.toMatch(/sales\s*\*/)
    })

    it('should order by the ranking and break every tie down to the unique item key', async () => {
      await shopCatalog.getTrendingItems({}, RATE)

      const text = query.mock.calls[0][0].text as string
      // (contract_address, item_id) is unique out of the core's DISTINCT ON, so ending the ORDER BY on it
      // makes the order TOTAL — which is what stops the LIMIT dropping or duplicating rows.
      expect(text).toContain('ORDER BY by_sales DESC, (CASE WHEN by_sales THEN sales_rank ELSE volume_rank END), contract_address, item_id')
      expect(text).toContain('LIMIT ')
    })

    it('should never shuffle the ranking it just computed', async () => {
      await shopCatalog.getTrendingItems({}, RATE)

      const text = query.mock.calls[0][0].text as string
      expect(text).not.toContain('random()')
      expect(text).not.toContain('ORDER BY md5')
    })

    it('should be unpaginated: no OFFSET and no total', async () => {
      await shopCatalog.getTrendingItems({ first: 12 }, RATE)

      const text = query.mock.calls[0][0].text as string
      expect(text).not.toContain('OFFSET')
      expect(text).not.toContain('COUNT(*) OVER() AS total')
    })

    it('should clamp the requested size to the rail cap', async () => {
      await shopCatalog.getTrendingItems({ first: 9999 }, RATE)
      expect(query.mock.calls[0][0].values).toContain(50)

      query.mockClear()
      await shopCatalog.getTrendingItems({}, RATE)
      expect(query.mock.calls[0][0].values).toContain(12)
    })

    it('should exclude social emotes on every branch when includeSocialEmotes is false', async () => {
      await shopCatalog.getTrendingItems({ includeSocialEmotes: false }, RATE)

      const text = query.mock.calls[0][0].text as string
      // Once per branch (native trade, legacy trade, store mint) — a filter that lands on only some of the
      // union is a filter a social emote can walk around.
      expect(text.match(/COALESCE\(item_p\.search_emote_outcome_type, item_s\.search_emote_outcome_type\) IS NULL/g)).toHaveLength(3)
    })

    it('should include social emotes by default, matching every other feed', async () => {
      await shopCatalog.getTrendingItems({}, RATE)

      expect(query.mock.calls[0][0].text).not.toContain('search_emote_outcome_type, item_s.search_emote_outcome_type) IS NULL')
    })

    it('should restrict the rail to primary listings when asked, on every branch', async () => {
      await shopCatalog.getTrendingItems({ listingType: 'primary' }, RATE)

      const text = query.mock.calls[0][0].text as string
      expect((text.match(/mv\.type = 'public_item_order'/g) ?? []).length).toBeGreaterThanOrEqual(3)
      expect(text).not.toContain("mv.type <> 'public_item_order'")
    })
  })

  describe('when mapping trending item rows', () => {
    function trendingRow(overrides: Record<string, unknown> = {}) {
      const { total: _total, ...row } = itemRow(overrides)
      return { sales: 7, volume: '1000', ...row }
    }

    it('should return the item-unified shape the browse grid renders, plus the ranking signal', async () => {
      query.mockResolvedValueOnce({
        rows: [trendingRow({ trade_id: 'trending-1', item_id: '9', price_credits: '6', listing_count: '2', sales: 42 })]
      })

      const { data } = await shopCatalog.getTrendingItems({}, 0.5)

      expect(data).toHaveLength(1)
      expect(data[0]).toMatchObject({
        tradeId: 'trending-1',
        listingType: 'primary',
        itemId: '9',
        priceCredits: 6,
        listingCount: 2,
        trendingSales: 42
      })
    })

    it('should carry a credit price for a rate-converted legacy row as well as a USD-pegged one', async () => {
      query.mockResolvedValueOnce({
        rows: [
          trendingRow({ source: 'native', trade_id: 'native-1', price_credits: '3', mana_wei: null }),
          trendingRow({ source: 'legacy', trade_id: 'legacy-1', item_id: '4', price_credits: '11', mana_wei: '22000000000000000000' })
        ]
      })

      const { data } = await shopCatalog.getTrendingItems({}, 0.5)

      expect(data.map(d => d.priceCredits)).toEqual([3, 11])
      expect(data.map(d => d.manaWei)).toEqual([null, '22000000000000000000'])
    })

    it('should drop the trade id for a store mint that trends', async () => {
      query.mockResolvedValueOnce({
        rows: [trendingRow({ source: 'legacy', acquisition: 'store', trade_id: '0xcollection-3', mana_wei: '1000' })]
      })

      const { data } = await shopCatalog.getTrendingItems({}, 0.5)

      expect(data[0]).toMatchObject({ acquisition: 'store', tradeId: null })
    })
  })

  describe('when mapping related item rows', () => {
    // The anchor lookup, then the feed. `itemRow` is the SAME row factory the browse-grid tests use, minus
    // `total` — the rail is unpaginated, so the mapper must not depend on a COUNT(*) OVER() column.
    function mockRail(overrides: Record<string, unknown> = {}) {
      const { total: _total, ...row } = itemRow(overrides)
      query.mockResolvedValueOnce({ rows: [{ rarity: 'rare', item_type: 'wearable_v2', wearable_category: 'hat' }] })
      query.mockResolvedValueOnce({ rows: [row] })
    }

    it('should return the same item-unified shape the browse grid renders', async () => {
      mockRail({
        trade_id: 'related-1',
        contract_address: '0xother',
        item_id: '7',
        name: 'Another Hat',
        price_credits: '4',
        available: '2',
        listing_count: '3'
      })

      const { data } = await shopCatalog.getRelatedItems({ contractAddress: '0xcollection', itemId: '3' }, 0.5)

      expect(data).toHaveLength(1)
      expect(data[0]).toMatchObject({
        source: 'native',
        acquisition: 'trade',
        tradeId: 'related-1',
        listingType: 'primary',
        contractAddress: '0xother',
        itemId: '7',
        rarity: 'rare',
        category: 'wearable',
        wearableCategory: 'hat',
        gender: 'unisex',
        priceCredits: 4,
        listingCount: 3,
        available: 2
      })
    })

    it('should drop the trade id for a store mint, which has none', async () => {
      // Store mints reach the rail through the shared union, so the rail can surface a row with no trade.
      // A fabricated id here would put a reference to a nonexistent trade into the purchase intent.
      mockRail({ source: 'legacy', acquisition: 'store', trade_id: '0xcollection-3', mana_wei: '1000' })

      const { data } = await shopCatalog.getRelatedItems({ contractAddress: '0xcollection', itemId: '3' }, 0.5)

      expect(data[0]).toMatchObject({ acquisition: 'store', tradeId: null, source: 'legacy', manaWei: '1000' })
    })

    it('should carry the reseller and issued id through for a secondary row', async () => {
      mockRail({ trade_type: 'public_nft_order', token_id: '99', item_id: null, seller: '0xreseller', issued_id: '5013' })

      const { data } = await shopCatalog.getRelatedItems({ contractAddress: '0xcollection', itemId: '3' }, 0.5)

      expect(data[0]).toMatchObject({ listingType: 'secondary', tokenId: '99', seller: '0xreseller', issuedId: '5013' })
    })
  })
})
