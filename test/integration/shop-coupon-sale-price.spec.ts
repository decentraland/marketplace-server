import SQL from 'sql-template-strings'
import { saleWeiExpr } from '../../src/ports/shop-catalog/component'
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
