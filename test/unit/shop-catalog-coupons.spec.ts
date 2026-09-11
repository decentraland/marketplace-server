import { ILoggerComponent } from '@well-known-components/interfaces'
import { IPgComponent } from '../../src/ports/db/types'
import { createShopCatalogComponent } from '../../src/ports/shop-catalog/component'
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
    signature: '0xsig'
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
      expect(sql.text).toContain('ORDER BY c.discount_ppm DESC, c.expires_at ASC')
      expect(sql.text).toContain('AS sale_price')
      expect(sql.text).toContain('AS coupon')
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
        'ORDER BY COALESCE((mv.amount_received::numeric - FLOOR(mv.amount_received::numeric * cp.discount_ppm / 1000000)), mv.amount_received::numeric) ASC'
      )
      expect(text).toContain(
        'AND COALESCE((mv.amount_received::numeric - FLOOR(mv.amount_received::numeric * cp.discount_ppm / 1000000)), mv.amount_received::numeric) >='
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
            coupon: couponRow(),
            coupon_discount_ppm: '300000'
          })
        ]
      })
      const { data } = await component.getShopListings({})
      expect(data[0]).toMatchObject({ priceCredits: 7, compareAtCredits: 10, saleEndsAt: 1800000000 })
      expect(data[0].coupon).toMatchObject({ id: 'coupon-1', discount: 300000, proof: [] })
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
      expect(data[0]).toMatchObject({ priceCredits: 1, compareAtCredits: null, saleEndsAt: null, coupon: null })
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
        unifiedRow({ price_credits: '7', compare_at_credits: '10', sale_ends_at: '1800000000', coupon: couponRow(), listing_count: '1' })
      ]
    })
    const { data } = await component.getShopItems({}, 0.25)
    expect(data[0]).toMatchObject({ priceCredits: 7, compareAtCredits: 10, saleEndsAt: 1800000000 })
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
