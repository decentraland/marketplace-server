import { test } from '../components'

/**
 * The collection-set filter on `/v3/catalog/unified`, exercised against a REAL Postgres.
 *
 * This is deliberately a SQL-VALIDITY contract, not a filtering-semantics one. Which rows each filter
 * selects is covered by the unit specs, which assert the emitted predicate per UNION branch; what those
 * cannot tell you is whether the SQL they emit is accepted by Postgres at all, because they run against a
 * mocked `query`. Two things here can only fail on a live server:
 *
 * - `= ANY($n)` binding a JS string array against `mv.sent_contract_address`. The sibling array filters in
 *   the same function cast (`::text[]`) and this one does not, so a wrong inference would be a 500.
 * - `AND FALSE` landing in all three branches of the UNION for an empty set. A predicate in the wrong
 *   position is a syntax error the mocked specs would never see.
 *
 * A seeded end-to-end version would be better still, but no row reaches this feed through the existing
 * helpers — it wants a USD-pegged trade, which nothing in `test/integration/utils` builds yet.
 */
test('when filtering the unified shop catalog by a set of collections', function ({ components }) {
  const A = '0xabc0000000000000000000000000000000000001'
  const B = '0xdef0000000000000000000000000000000000002'

  const get = async (query: string) => {
    const response = await components.localFetch.fetch(`/v3/catalog/unified${query}`)
    return { status: response.status, body: (await response.json()) as { data: unknown[]; total: number } }
  }

  describe('and no collection is named', () => {
    it('should answer without a collection filter', async () => {
      const { status } = await get('')

      expect(status).toEqual(200)
    })
  })

  describe('and one collection is named', () => {
    it('should answer, as it did before the set was accepted', async () => {
      const { status } = await get(`?contractAddress=${A}`)

      expect(status).toEqual(200)
    })
  })

  describe('and several collections are named', () => {
    it('should bind the set in the comma-separated form', async () => {
      const { status } = await get(`?contractAddress=${A},${B}`)

      expect(status).toEqual(200)
    })

    it('should bind the set in the repeated form', async () => {
      const { status } = await get(`?contractAddress=${A}&contractAddress=${B}`)

      expect(status).toEqual(200)
    })

    it('should bind the set on the item-unified feed too', async () => {
      const { status } = await get(`?groupBy=item&contractAddress=${A},${B}`)

      expect(status).toEqual(200)
    })
  })

  describe('and the named collections resolve to nothing', () => {
    it('should return an empty page rather than fail', async () => {
      // The `AND FALSE` path, in every union branch. A 500 here means the predicate landed somewhere that
      // does not parse; a non-empty page means it did not land at all, which is the failure that matters —
      // the whole catalogue served as if it were the event.
      const { status, body } = await get('?contractAddress=not-an-address')

      expect(status).toEqual(200)
      expect(body.data).toEqual([])
      expect(body.total).toBe(0)
    })

    it('should return an empty page on the item-unified feed too', async () => {
      const { status, body } = await get('?groupBy=item&contractAddress=not-an-address')

      expect(status).toEqual(200)
      expect(body.data).toEqual([])
      expect(body.total).toBe(0)
    })
  })
})
