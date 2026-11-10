import SQL from 'sql-template-strings'
import { saleWeiExpr, shopCreditsExpr, visibleDiscountExpr } from '../../src/ports/shop-catalog/component'
import { test } from '../components'

/**
 * The coupon sale price, computed by REAL Postgres and compared with the contract's integer math.
 *
 * A MANA listing under a creator coupon is bought for exactly this amount, so it has to match
 * `price - price * ppm / 1e6` as Solidity truncates it, to the wei. Numeric division picks its result scale from
 * the operands and can round a wei-sized quotient before any FLOOR sees it, so this is only checkable on a live
 * server: the unit specs run against a mocked `query`.
 */
test('when pricing a listing under a creator coupon', function ({ components }) {
  const cases: Array<[bigint, number]> = [
    [10000000000000000002n, 300_000],
    [10000000000000000005n, 300_000],
    [999999999999999999n, 50_000],
    [123456789012345678901n, 700_000],
    [100000000000000000000n, 300_000],
    [7n, 300_000],
    [1n, 700_000]
  ]

  it.each(cases)('should charge %s wei at %s ppm exactly what the contract charges', async (price, ppm) => {
    const query = SQL`SELECT `.append(saleWeiExpr()).append(SQL`::text AS sale
      FROM (VALUES (${price.toString()}::numeric(78,0))) AS mv(amount_received),
           (VALUES (${ppm}::integer)) AS cp(discount_ppm)`)

    const { rows } = await components.dappsDatabase.query<{ sale: string }>(query)

    expect(rows[0].sale).toEqual((price - (price * BigInt(ppm)) / 1_000_000n).toString())
  })
})

/**
 * Whether a coupon visibly lowers a shop listing, decided by REAL Postgres and compared with the row mapper's rule:
 * both prices rounded up to whole credits, on sale only while the sale is still the cheaper one. The Deals filter
 * runs this predicate, so a disagreement lists an item the grid then shows at its list price.
 */
test('when deciding whether a coupon visibly discounts a shop listing', function ({ components }) {
  const WEI_PER_CREDIT = 100000000000000000n
  const wholeCredits = (wei: bigint) => (wei + WEI_PER_CREDIT - 1n) / WEI_PER_CREDIT
  const cases: Array<[bigint, number]> = [
    [4n * WEI_PER_CREDIT, 200_000],
    [5n * WEI_PER_CREDIT, 200_000],
    [3n * WEI_PER_CREDIT, 200_000],
    [20n * WEI_PER_CREDIT, 500_000],
    [3n * WEI_PER_CREDIT + 1n, 1],
    [10000000000000000002n, 300_000],
    [123456789012345678901n, 700_000]
  ]

  it.each(cases)('should show the sale on %s wei at %s ppm exactly when the row mapper does', async (price, ppm) => {
    const query = SQL`SELECT `
      .append(visibleDiscountExpr({ sale: shopCreditsExpr(saleWeiExpr()), list: shopCreditsExpr(SQL`mv.amount_received::numeric`) }))
      .append(
        SQL` AS visible
      FROM (VALUES (${price.toString()}::numeric(78,0))) AS mv(amount_received),
           (VALUES ('coupon-1'::text, ${ppm}::integer)) AS cp(id, discount_ppm)`
      )

    const { rows } = await components.dappsDatabase.query<{ visible: boolean }>(query)

    const sale = price - (price * BigInt(ppm)) / 1_000_000n
    expect(rows[0].visible).toBe(wholeCredits(sale) < wholeCredits(price))
  })
})

/**
 * The opt-in that lets creator coupons discount classic MANA listings, as SQL-VALIDITY against real Postgres.
 *
 * The unit specs assert the emitted text against a mocked `query`; what they cannot catch is a UNION whose
 * branches disagree on the extra column the opt-in selects, which only a live server rejects.
 */
test('when the unified shop catalog is asked to discount MANA listings', function ({ components }) {
  const get = async (query: string) => {
    const response = await components.localFetch.fetch(`/v3/catalog/unified${query}`)
    return { status: response.status, body: (await response.json()) as { data: unknown[]; total: number } }
  }

  it.each([
    ['the listing feed', '?includeLegacyCoupons=true'],
    ['the grouped item feed', '?groupBy=item&includeLegacyCoupons=true'],
    ['only discounted items', '?groupBy=item&includeLegacyCoupons=true&discounted=true'],
    ['the cheapest first', '?groupBy=item&includeLegacyCoupons=true&sortBy=cheapest'],
    ['legacy resales too', '?includeLegacyCoupons=true&includeLegacySecondary=true']
  ])('should answer for %s', async (_, query) => {
    const { status, body } = await get(query)

    expect(status).toEqual(200)
    expect(Array.isArray(body.data)).toBe(true)
  })
})
