import { test } from '../components'

/**
 * The only coverage the trades materialized view has.
 *
 * Its definition lives in recreateTradesMaterializedView and is applied either by this endpoint or by the
 * migration that shares the same constants, and until now nothing executed it: the unit specs cover the
 * debounce and gate helpers against a mocked pg, and no test creates the view. So a syntax error, a column
 * the indexer schema does not have, or a missing role only surfaced when an operator called this in
 * production. These tests run the real thing against real Postgres.
 */
test('trades materialized view controller', function ({ components }) {
  const RECREATE_PATH = '/v1/trades/materialized-view/recreate'
  // Matches MARKETPLACE_SERVER_TRADES_API_TOKEN in .env.spec.
  const API_TOKEN = 'integration-test-token'

  describe('when recreating the trades materialized view', () => {
    describe('and no api token is sent', () => {
      it('should respond with a 401 and not touch the view', async () => {
        const { localFetch } = components

        const response = await localFetch.fetch(RECREATE_PATH, { method: 'POST' })

        expect(response.status).toBe(401)
      })
    })

    describe('and the api token is wrong', () => {
      it('should respond with a 401', async () => {
        const { localFetch } = components

        const response = await localFetch.fetch(RECREATE_PATH, {
          method: 'POST',
          headers: { 'x-api-token': 'not-the-token' }
        })

        expect(response.status).toBe(401)
      })
    })

    describe('and the api token is valid', () => {
      let definition: string

      beforeEach(async () => {
        const { localFetch, dappsDatabase } = components

        const response = await localFetch.fetch(RECREATE_PATH, {
          method: 'POST',
          headers: { 'x-api-token': API_TOKEN }
        })
        expect(response.status).toBe(200)

        const result = await dappsDatabase.query<{ definition: string }>(
          "SELECT definition FROM pg_matviews WHERE schemaname = 'marketplace' AND matviewname = 'mv_trades'"
        )
        definition = result.rows[0]?.definition ?? ''
      })

      it('should create the materialized view', () => {
        expect(definition).not.toBe('')
      })

      // Postgres stores a matview's compiled definition, so these assert what the database actually
      // accepted and normalised, not what the source string happened to say. Regexes rather than exact
      // strings because Postgres adds its own casts when it rewrites the expression.
      it('should match a trade on either identifier, so a V3 cancellation resolves', () => {
        expect(definition).toMatch(/st\.signature = ANY \(ARRAY\[t\.hashed_signature, t\.trade_digest\]\)/)
      })

      it('should count a cancellation only when the canceller is the trade signer', () => {
        expect(definition).toMatch(/'cancelled'.*AND \(?lower\(st\.caller\) = lower\(\(?t\.signer\)?/)
      })

      it('should translate MATIC to the network name the indexer writes', () => {
        expect(definition).toMatch(/WHEN \(t\.network = 'MATIC'::text\) THEN 'POLYGON'::text/)
      })

      // Once for the contract signature index, once for the signer one.
      it('should scope both signature index joins by network', () => {
        expect(definition.match(/THEN 'POLYGON'::text/g)).toHaveLength(2)
      })

      it('should be queryable', async () => {
        const { dappsDatabase } = components

        const result = await dappsDatabase.query<{ count: string }>('SELECT count(*) AS count FROM marketplace.mv_trades')

        expect(result.rows).toHaveLength(1)
      })

      it('should create the unique index the concurrent refresh depends on', async () => {
        const { dappsDatabase } = components

        const result = await dappsDatabase.query<{ indexname: string }>(
          "SELECT indexname FROM pg_indexes WHERE schemaname = 'marketplace' AND indexname = 'idx_mv_trades_id'"
        )

        expect(result.rows).toHaveLength(1)
      })
    })
  })
})
