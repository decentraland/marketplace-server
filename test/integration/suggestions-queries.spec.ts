import SQL from 'sql-template-strings'
import { PROFILE_SQL_LIMIT } from '../../src/logic/suggestions/constants'
import type { ProfileEntry } from '../../src/logic/suggestions/profile'
import {
  buildCandidateContractsQuery,
  buildCandidateScoresQuery,
  buildOwnedAmongQuery,
  buildOwnedQuery,
  buildProfileAttributesQuery
} from '../../src/ports/suggestions/queries'
import { test } from '../components'

/**
 * Executes every query the suggestions endpoint builds, against real Postgres.
 *
 * The unit specs assert on the SQL as TEXT, which cannot tell valid SQL from invalid: a `SELECT
 * DISTINCT` ordered by an expression outside its select list reached a pushed branch that way, and
 * would have answered every signed-in request with a 500. Postgres rejects that at parse-analysis
 * time, so simply running each statement catches it — no fixtures needed, and an empty result is a
 * pass. What is being tested is that the database accepts the statement at all.
 */
test('suggestions queries', function ({ components }) {
  const ADDRESS = '0x1096f950841a99f9b961434714d9a08d3d4ebdff'
  const PROFILE: ProfileEntry[] = [
    { itemId: '0xaaa-1', weight: 1, source: 'owned' },
    { itemId: '0xbbb-2', weight: 0.8, source: 'seed' }
  ]

  async function run(statement: { text: string; values: unknown[] }): Promise<void> {
    const client = await components.dappsDatabase.getPool().connect()
    try {
      await client.query({ text: statement.text, values: statement.values })
    } finally {
      client.release()
    }
  }

  describe('when asking what a wallet bought', () => {
    it('should be accepted by the database', async () => {
      await expect(run(buildOwnedQuery(ADDRESS, PROFILE_SQL_LIMIT))).resolves.toBeUndefined()
    })
  })

  describe('when resolving the attributes of the profile items', () => {
    it('should be accepted by the database', async () => {
      await expect(run(buildProfileAttributesQuery(['0xaaa-1', '0xbbb-2'], 0.0179))).resolves.toBeUndefined()
    })
  })

  describe('when asking which of a handful of candidates the wallet already holds', () => {
    it('should be accepted by the database', async () => {
      await expect(run(buildOwnedAmongQuery(ADDRESS, ['0xaaa-1', '0xbbb-2']))).resolves.toBeUndefined()
    })
  })

  describe('when resolving which collections the candidates live in', () => {
    describe('and the profile leans on particular creators', () => {
      it('should be accepted by the database', async () => {
        await expect(run(buildCandidateContractsQuery(PROFILE, ['0xcreator']))).resolves.toBeUndefined()
      })
    })

    describe('and it leans on no creator in particular', () => {
      it('should be accepted by the database', async () => {
        await expect(run(buildCandidateContractsQuery(PROFILE, []))).resolves.toBeUndefined()
      })
    })
  })

  describe('when scoring the candidates', () => {
    const core = SQL`SELECT
        'native'::text AS source, 'trade'::text AS acquisition, 't'::text AS trade_id,
        'public_item_order'::text AS trade_type, '0xc'::text AS contract_address, '1'::text AS item_id,
        NULL::text AS token_id, 'n'::text AS name, ''::text AS image, 'epic'::text AS rarity,
        'wearable_v2'::text AS item_type, 'hat'::text AS wearable_category, NULL::boolean AS emote_loop,
        'unisex'::text AS gender, '0xcreator'::text AS creator, NULL::text AS seller,
        NULL::text AS issued_id, 1::bigint AS price_credits, NULL::text AS mana_wei, 1::numeric AS available,
        1::bigint AS created_at, 1::bigint AS listing_count, 1::numeric AS usd_wei`

    describe('and the caller is a known wallet', () => {
      it('should be accepted by the database', async () => {
        await expect(
          run(
            buildCandidateScoresQuery({
              profile: PROFILE,
              core,
              address: ADDRESS,
              excludeItemIds: ['0xccc-9'],
              bodyShape: 'BaseFemale',
              topCreators: ['0xcreator'],
              limit: 36
            })
          )
        ).resolves.toBeUndefined()
      })
    })

    describe('and the caller is anonymous with seeds only', () => {
      it('should be accepted by the database', async () => {
        await expect(
          run(
            buildCandidateScoresQuery({
              profile: PROFILE,
              core,
              excludeItemIds: [],
              topCreators: [],
              limit: 36
            })
          )
        ).resolves.toBeUndefined()
      })
    })
  })
})
