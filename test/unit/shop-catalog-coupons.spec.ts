import { ILoggerComponent } from '@well-known-components/interfaces'
import { IPgComponent } from '../../src/ports/db/types'
import { createShopCatalogComponent, rateToNumericString } from '../../src/ports/shop-catalog/component'
import { IShopCatalogComponent } from '../../src/ports/shop-catalog/types'

// 1 credit = $0.10 = 1e17 USD wei.
const WEI_PER_CREDIT = 100000000000000000n
const COLLECTION = '0x4c09495cd2d4e3d3fa2808eb655d013de426157b'
const OTHER_COLLECTION = '0xb0d0d31910da4a14d4e05a9d51b6e9a99a85d676'

const logs: ILoggerComponent = {
  getLogger: () => ({ log: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })
}

function couponRow(collections: string[] = [COLLECTION]) {
  return {
    id: 'coupon-1',
    signer: '0xcreator',
    couponManager: '0x3fd3056ee72a2a85e9392fab3a450e7736536081',
    couponAddress: '0xc914507fe297b2dddd1232ac3a8903f1c125e794',
    checks: {
      uses: 10,
      expiration: 1800000000000,
      effective: 0,
      salt: '0x11',
      contractSignatureIndex: 0,
      signerSignatureIndex: 0,
      allowedRoot: '0x',
      externalChecks: []
    },
    discountType: 1,
    discount: 300000,
    root: '0xroot',
    collections,
    signature: '0xsig',
    used: 3
  }
}

function shopRow(overrides: Record<string, unknown> = {}) {
  return {
    trade_id: 'trade-1',
    trade_type: 'public_item_order',
    contract_address: COLLECTION,
    item_id: '0',
    token_id: null,
    name: 'Reverence',
    image: 'ipfs://reverence.png',
    rarity: 'COMMON',
    item_type: 'wearable_v2',
    wearable_category: 'hat',
    gender: 'unisex',
    creator: '0xcreator',
    seller: null,
    issued_id: null,
    price: (10n * WEI_PER_CREDIT).toString(),
    sale_price: null,
    sale_ends_at: null,
    sale_units_left: null,
    coupon: null,
    coupon_discount_ppm: null,
    available: '99894',
    network: 'MATIC',
    created_at: '1700000000000',
    total: '1',
    ...overrides
  }
}

function unifiedRow(overrides: Record<string, unknown> = {}) {
  return {
    source: 'native',
    acquisition: 'trade',
    trade_id: 'trade-1',
    trade_type: 'public_item_order',
    contract_address: COLLECTION,
    item_id: '0',
    token_id: null,
    name: 'Reverence',
    image: 'ipfs://reverence.png',
    rarity: 'COMMON',
    item_type: 'wearable_v2',
    wearable_category: 'hat',
    emote_loop: null,
    gender: 'unisex',
    creator: '0xcreator',
    seller: null,
    issued_id: null,
    price_credits: '10',
    compare_at_credits: null,
    sale_ends_at: null,
    sale_units_left: null,
    coupon: null,
    coupon_discount_ppm: null,
    mana_wei: null,
    available: '99894',
    network: 'MATIC',
    created_at: '1700000000000',
    total: '1',
    ...overrides
  }
}

describe('when the shop feed carries creator coupons', () => {
  let query: jest.Mock
  let component: IShopCatalogComponent

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] })
    component = createShopCatalogComponent({ dappsDatabase: { query } as unknown as IPgComponent, logs })
  })

  describe('and listings are queried', () => {
    it('should join the best live coupon of the creator, excluding cancelled, revoked and exhausted ones', async () => {
      await component.getShopListings({})
      const sql = query.mock.calls[0][0]
      expect(sql.text).toContain('LEFT JOIN LATERAL')
      expect(sql.text).toContain('FROM marketplace.coupons c')
      expect(sql.text).toContain("mv.type = 'public_item_order'")
      expect(sql.text).toContain('COALESCE(cs.cancelled, false) = false')
      expect(sql.text).toContain('COALESCE(cs.revoked, false) = false')
      expect(sql.text).toContain("COALESCE(cs.uses, 0) < (c.checks->>'uses')::numeric")
      // The consumed count rides along so the Shop can say how many units are left at the sale price.
      expect(sql.text).toContain('COALESCE(cs.uses, 0) AS used')
      expect(sql.text).toContain("'used', cp.used")
      // Units left at the sale price: the coupon's remaining uses, capped by the listing's supply.
      expect(sql.text).toContain("LEAST(\n          (cp.checks->>'uses')::numeric - cp.used,")
      expect(sql.text).toContain('AS sale_units_left')
      expect(sql.text).toContain('ORDER BY c.discount_ppm DESC, c.expires_at ASC')
      expect(sql.text).toContain('AS sale_price')
      expect(sql.text).toContain('AS coupon')
    })

    describe('and the coupon join is built', () => {
      let sql: { text: string; values: unknown[] }
      let marketplaces: string[]
      let managers: string[]
      let pairedChainIds: number[]

      beforeEach(async () => {
        await component.getShopListings({})
        sql = query.mock.calls[0][0]
        // The pairings ride along as three aligned arrays, so a marketplace's manager is the entry at its index.
        marketplaces = sql.values.find(
          (value: unknown) => Array.isArray(value) && value.includes('0xe38ef22abe871513555cba89adfe45ab4f548ada')
        ) as string[]
        managers = sql.values.find(
          (value: unknown) => Array.isArray(value) && value.includes('0x655fdfa91d69ea49f4ce1a8f7f7e2622c8630813')
        ) as string[]
        pairedChainIds = sql.values.find(
          (value: unknown) =>
            Array.isArray(value) && value.length > 1 && value.every(entry => typeof entry === 'number') && value[1] === 137
        ) as number[]
      })

      it('should require the manager to be the one paired with the marketplace the listing names', () => {
        expect(sql.text).toContain('pairing.marketplace = LOWER(mv.trade_contract)')
      })

      it("should match that pairing on the coupon's own manager and chain", () => {
        expect(sql.text).toContain('pairing.coupon_manager = LOWER(c.coupon_manager)')
        expect(sql.text).toContain('pairing.chain_id = c.chain_id')
      })

      it('should give each live Polygon mainnet version the manager it redeems through', () => {
        expect([
          managers[marketplaces.indexOf('0xe38ef22abe871513555cba89adfe45ab4f548ada')],
          managers[marketplaces.indexOf('0xa40b1d129b8906888720686f3a01921ddf37716f')]
        ]).toEqual(['0x655fdfa91d69ea49f4ce1a8f7f7e2622c8630813', '0x3fd3056ee72a2a85e9392fab3a450e7736536081'])
      })

      it("should require the coupon to be on the listing's own chain, which its network does not identify", () => {
        expect(sql.text).toContain('AND c.chain_id = mv.chain_id')
      })

      it('should hold the listing to a chain this deployment serves, since it could not be bought otherwise', () => {
        expect(sql.text).toContain('AND mv.chain_id = ANY(')
      })

      it('should bind those served chains as the values of that check', () => {
        expect(sql.values).toContainEqual([137, 1])
      })

      it('should offer pairings for no chain beyond them', () => {
        expect([...new Set(pairedChainIds)]).toEqual([137])
      })
    })

    it('should keep only discounted listings on discounted=true and only the rest on discounted=false', async () => {
      await component.getShopListings({ discounted: true })
      expect(query.mock.calls[0][0].text).toContain('AND cp.id IS NOT NULL')
      await component.getShopListings({ discounted: false })
      expect(query.mock.calls[1][0].text).toContain('AND cp.id IS NULL')
      await component.getShopListings({})
      expect(query.mock.calls[2][0].text).not.toContain('cp.id IS NULL')
    })

    it('should sort and bound prices by what the buyer would pay', async () => {
      await component.getShopListings({ sortBy: 'cheapest', minPriceCredits: 2, maxPriceCredits: 8 })
      const text = query.mock.calls[0][0].text
      expect(text).toContain(
        'ORDER BY COALESCE((mv.amount_received::numeric - div(mv.amount_received::numeric * cp.discount_ppm, 1000000::numeric)), mv.amount_received::numeric) ASC'
      )
      expect(text).toContain(
        'AND COALESCE((mv.amount_received::numeric - div(mv.amount_received::numeric * cp.discount_ppm, 1000000::numeric)), mv.amount_received::numeric) >='
      )
    })

    it('should order the deals rail by biggest discount, then soonest ending', async () => {
      await component.getShopListings({ sortBy: 'discount' })
      expect(query.mock.calls[0][0].text).toContain(
        'ORDER BY cp.discount_ppm DESC NULLS LAST, cp.expires_at ASC NULLS LAST, mv.created_at DESC'
      )
    })
  })

  describe('and a listing carries a coupon', () => {
    it('should price it at the sale price, expose the list price as compare-at and attach the coupon with its proof', async () => {
      query.mockResolvedValueOnce({
        rows: [
          shopRow({
            sale_price: (7n * WEI_PER_CREDIT).toString(),
            sale_ends_at: '1800000000',
            sale_units_left: '3',
            coupon: couponRow(),
            coupon_discount_ppm: '300000'
          })
        ]
      })
      const { data } = await component.getShopListings({})
      expect(data[0]).toMatchObject({ priceCredits: 7, compareAtCredits: 10, saleEndsAt: 1800000000, saleUnitsLeft: 3 })
      expect(data[0].coupon).toMatchObject({ id: 'coupon-1', discount: 300000, proof: [], used: 3 })
    })

    it('should build a non-empty proof when the coupon covers several collections', async () => {
      query.mockResolvedValueOnce({
        rows: [
          shopRow({
            sale_price: (7n * WEI_PER_CREDIT).toString(),
            sale_ends_at: '1800000000',
            coupon: couponRow([COLLECTION, OTHER_COLLECTION])
          })
        ]
      })
      const { data } = await component.getShopListings({})
      expect(data[0].coupon?.proof).toHaveLength(1)
    })

    it('should not advertise a sale the rounding erases', async () => {
      // 1 credit at 30% off is 0.7 credit, which rounds back up to 1: nothing for the buyer to see.
      query.mockResolvedValueOnce({
        rows: [
          shopRow({
            price: WEI_PER_CREDIT.toString(),
            sale_price: ((7n * WEI_PER_CREDIT) / 10n).toString(),
            sale_ends_at: '1800000000',
            coupon: couponRow()
          })
        ]
      })
      const { data } = await component.getShopListings({})
      expect(data[0]).toMatchObject({
        priceCredits: 1,
        compareAtCredits: null,
        saleEndsAt: null,
        saleUnitsLeft: null,
        coupon: null
      })
    })

    it('should drop a coupon whose proof cannot be built and show the list price', async () => {
      query.mockResolvedValueOnce({
        rows: [shopRow({ sale_price: (7n * WEI_PER_CREDIT).toString(), sale_ends_at: '1800000000', coupon: couponRow([OTHER_COLLECTION]) })]
      })
      const { data } = await component.getShopListings({})
      expect(data[0]).toMatchObject({ priceCredits: 10, compareAtCredits: null, coupon: null })
    })

    it('should leave a listing without a coupon exactly as before', async () => {
      query.mockResolvedValueOnce({ rows: [shopRow()] })
      const { data } = await component.getShopListings({})
      expect(data[0]).toMatchObject({ priceCredits: 10, compareAtCredits: null, saleEndsAt: null, coupon: null })
    })
  })
})

describe('when the unified feed carries creator coupons', () => {
  let query: jest.Mock
  let component: IShopCatalogComponent

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] })
    component = createShopCatalogComponent({ dappsDatabase: { query } as unknown as IPgComponent, logs })
  })

  it('should discount only the native branch and keep the legacy and store branches coupon-free', async () => {
    await component.getUnifiedListings({}, 0.25)
    const text = query.mock.calls[0][0].text
    expect(text).toContain('LEFT JOIN LATERAL')
    expect(text).toContain('CASE WHEN cp.id IS NOT NULL THEN mv.amount_received::numeric END AS compare_at_usd_wei')
    expect(text).toContain('NULL::numeric AS compare_at_usd_wei')
    expect(text).toContain('NULL::jsonb AS coupon')
    expect(text).toContain('NULL::bigint AS sale_units_left')
    expect(text).toContain('AS compare_at_credits')
  })

  it('should turn discounted=true into a coupon requirement on the native branch and an empty legacy branch', async () => {
    await component.getUnifiedListings({ discounted: true }, 0.25)
    const text = query.mock.calls[0][0].text
    expect(text).toContain('AND cp.id IS NOT NULL')
    expect(text).toContain('AND FALSE')
  })

  it('should sort by discount on both the listing feed and the item feed', async () => {
    await component.getUnifiedListings({ sortBy: 'discount' }, 0.25)
    expect(query.mock.calls[0][0].text).toContain(
      'ORDER BY sub.coupon_discount_ppm DESC NULLS LAST, sub.sale_ends_at ASC NULLS LAST, sub.trade_id'
    )
    await component.getShopItems({ sortBy: 'discount' }, 0.25)
    expect(query.mock.calls[1][0].text).toContain(
      'ORDER BY d.coupon_discount_ppm DESC NULLS LAST, d.sale_ends_at ASC NULLS LAST, d.trade_id'
    )
  })

  it('should map a discounted item with its compare-at, end and coupon', async () => {
    query.mockResolvedValueOnce({
      rows: [
        unifiedRow({
          price_credits: '7',
          compare_at_credits: '10',
          sale_ends_at: '1800000000',
          sale_units_left: '3',
          coupon: couponRow(),
          listing_count: '1'
        })
      ]
    })
    const { data } = await component.getShopItems({}, 0.25)
    expect(data[0]).toMatchObject({ priceCredits: 7, compareAtCredits: 10, saleEndsAt: 1800000000, saleUnitsLeft: 3 })
    expect(data[0].coupon).toMatchObject({ id: 'coupon-1', proof: [] })
  })

  it('should not advertise a sale when the rounded prices are equal', async () => {
    query.mockResolvedValueOnce({
      rows: [unifiedRow({ price_credits: '1', compare_at_credits: '1', sale_ends_at: '1800000000', coupon: couponRow() })]
    })
    const { data } = await component.getUnifiedListings({}, 0.25)
    expect(data[0]).toMatchObject({ priceCredits: 1, compareAtCredits: null, saleEndsAt: null, coupon: null })
  })
})

describe('when the unified feed is asked to discount classic MANA listings', () => {
  let query: jest.Mock
  let component: IShopCatalogComponent

  const countOf = (text: string, needle: string) => text.split(needle).length - 1

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] })
    component = createShopCatalogComponent({ dappsDatabase: { query } as unknown as IPgComponent, logs })
  })

  // The opt-in is what keeps a client whose MANA checkout calls plain accept from being shown a sale it would
  // then charge in full.
  it('should leave the legacy branch coupon-free without the opt-in', async () => {
    await component.getUnifiedListings({}, 0.25)
    const text = query.mock.calls[0][0].text
    expect(countOf(text, 'LEFT JOIN LATERAL')).toBe(1)
    expect(text).toContain('mv.amount_received::text AS mana_wei')
  })

  describe('and the opt-in is set', () => {
    it('should join creator coupons on the native and the legacy trade branches, never on the store', async () => {
      await component.getUnifiedListings({ includeLegacyCoupons: true }, 0.25)
      const text = query.mock.calls[0][0].text
      expect(countOf(text, 'LEFT JOIN LATERAL')).toBe(2)
      // The store branch, bought through CollectionStore.buy, still carries no coupon.
      expect(text).toContain('NULL::jsonb AS coupon')
    })

    it('should price a discounted MANA listing at the sale amount converted at the rate', async () => {
      await component.getUnifiedListings({ includeLegacyCoupons: true }, 0.25)
      const { text, values } = query.mock.calls[0][0]
      expect(text).toContain(
        '((mv.amount_received::numeric - div(mv.amount_received::numeric * cp.discount_ppm, 1000000::numeric)), mv.amount_received::numeric) * $'
      )
      expect(values).toContain(rateToNumericString(0.25))
    })

    it('should expose the MANA list price at the rate as the compare-at', async () => {
      await component.getUnifiedListings({ includeLegacyCoupons: true }, 0.25)
      expect(query.mock.calls[0][0].text).toMatch(
        /CASE WHEN cp\.id IS NOT NULL THEN \(mv\.amount_received::numeric \* \$\d+::numeric\) END AS compare_at_usd_wei/
      )
    })

    // What the checkout sizes the purchase from: acceptWithCoupon charges the sale amount, not the list price.
    it('should hand the client the sale MANA amount as mana_wei', async () => {
      await component.getUnifiedListings({ includeLegacyCoupons: true }, 0.25)
      expect(query.mock.calls[0][0].text).toContain(
        '(COALESCE((mv.amount_received::numeric - div(mv.amount_received::numeric * cp.discount_ppm, 1000000::numeric)), mv.amount_received::numeric))::text AS mana_wei'
      )
    })

    it('should let discounted=true keep discounted MANA listings and empty only the store branch', async () => {
      await component.getUnifiedListings({ includeLegacyCoupons: true, discounted: true }, 0.25)
      const text = query.mock.calls[0][0].text
      expect(countOf(text, 'AND cp.id IS NOT NULL')).toBe(2)
      expect(countOf(text, 'AND FALSE')).toBe(1)
    })

    it('should carry the opt-in into the grouped item feed', async () => {
      await component.getShopItems({ includeLegacyCoupons: true }, 0.25)
      expect(countOf(query.mock.calls[0][0].text, 'LEFT JOIN LATERAL')).toBe(2)
    })

    it('should keep the default SQL free of the list MANA column', async () => {
      await component.getUnifiedListings({}, 0.25)
      expect(query.mock.calls[0][0].text).not.toContain('list_mana_wei')
    })

    it('should select the list MANA price on every branch so the UNION lines up', async () => {
      await component.getUnifiedListings({ includeLegacyCoupons: true }, 0.25)
      const text = query.mock.calls[0][0].text
      expect(countOf(text, 'mv.amount_received::text AS list_mana_wei')).toBe(2)
      expect(countOf(text, 'NULL::text AS list_mana_wei')).toBe(1)
    })

    it('should drop discounted MANA listings on discounted=false', async () => {
      await component.getUnifiedListings({ includeLegacyCoupons: true, discounted: false }, 0.25)
      expect(countOf(query.mock.calls[0][0].text, 'AND cp.id IS NULL')).toBe(2)
    })

    it('should discount MANA listings on the related and trending rails too', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ category: 'wearable', wearable_category: 'hat', rarity: 'common' }] })
        .mockResolvedValue({ rows: [] })
      await component.getRelatedItems({ contractAddress: COLLECTION, itemId: '0', includeLegacyCoupons: true }, 0.25)
      const relatedTexts = query.mock.calls.map(([q]) => q.text as string)
      expect(relatedTexts.some(text => countOf(text, 'LEFT JOIN LATERAL') === 2)).toBe(true)

      query.mockClear()
      await component.getTrendingItems({ includeLegacyCoupons: true }, 0.25)
      expect(countOf(query.mock.calls[0][0].text, 'LEFT JOIN LATERAL')).toBe(2)
    })

    // The rounding to whole credits can erase a small discount; then the sale is not shown, and the row has to
    // be bought through plain accept at the list price, so manaWei must be the list price too.
    it('should fall back to the list price in credits and MANA when the rounding erases the sale', async () => {
      query.mockResolvedValueOnce({
        rows: [
          unifiedRow({
            source: 'legacy',
            price_credits: '9',
            compare_at_credits: '9',
            sale_ends_at: '1800000000',
            coupon: couponRow(),
            mana_wei: '9500000000000000000',
            list_mana_wei: '10000000000000000000'
          })
        ]
      })
      const { data } = await component.getUnifiedListings({ includeLegacyCoupons: true }, 0.09)
      expect(data[0]).toMatchObject({ priceCredits: 9, compareAtCredits: null, coupon: null, manaWei: '10000000000000000000' })
    })

    it('should fall back to the list price when the coupon proof cannot be built', async () => {
      query.mockResolvedValueOnce({
        rows: [
          unifiedRow({
            source: 'legacy',
            contract_address: OTHER_COLLECTION,
            price_credits: '7',
            compare_at_credits: '10',
            sale_ends_at: '1800000000',
            coupon: couponRow([COLLECTION]),
            mana_wei: '7000000000000000000',
            list_mana_wei: '10000000000000000000'
          })
        ]
      })
      const { data } = await component.getUnifiedListings({ includeLegacyCoupons: true }, 0.25)
      expect(data[0]).toMatchObject({ priceCredits: 10, compareAtCredits: null, coupon: null, manaWei: '10000000000000000000' })
    })

    it('should map a discounted MANA listing with its sale price, compare-at, coupon and sale MANA amount', async () => {
      query.mockResolvedValueOnce({
        rows: [
          unifiedRow({
            source: 'legacy',
            price_credits: '7',
            compare_at_credits: '10',
            sale_ends_at: '1800000000',
            sale_units_left: '7',
            coupon: couponRow(),
            mana_wei: '7000000000000000000',
            list_mana_wei: '10000000000000000000'
          })
        ]
      })
      const { data } = await component.getUnifiedListings({ includeLegacyCoupons: true }, 0.25)
      expect(data[0]).toMatchObject({
        source: 'legacy',
        priceCredits: 7,
        compareAtCredits: 10,
        saleEndsAt: 1800000000,
        manaWei: '7000000000000000000'
      })
      expect(data[0].coupon).toMatchObject({ id: 'coupon-1', proof: [] })
      expect(data[0].listManaWei).toBe('10000000000000000000')
    })

    it('should not expose a list amount once the sale is not shown', async () => {
      query.mockResolvedValueOnce({
        rows: [
          unifiedRow({
            source: 'legacy',
            price_credits: '9',
            compare_at_credits: '9',
            coupon: couponRow(),
            mana_wei: '9500000000000000000',
            list_mana_wei: '10000000000000000000'
          })
        ]
      })
      const { data } = await component.getUnifiedListings({ includeLegacyCoupons: true }, 0.09)
      expect(data[0]).not.toHaveProperty('listManaWei')
    })

    it('should leave a row without a list column exactly as before', async () => {
      query.mockResolvedValueOnce({ rows: [unifiedRow()] })
      const { data } = await component.getUnifiedListings({}, 0.25)
      expect(data[0]).not.toHaveProperty('listManaWei')
    })
  })
})
