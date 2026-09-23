import type { WornNeighbor } from '../../src/ports/worn-neighbors'
import { buildCoWornQuery } from '../../src/ports/worn-neighbors/queries'
import { test } from '../components'

type Profile = { pointer: string; timestamp: number; metadata: unknown }

function urn(contract: string, itemId: number, tokenId?: number): string {
  return `urn:decentraland:matic:collections-v2:${contract}:${itemId}${tokenId === undefined ? '' : `:${tokenId}`}`
}

/**
 * Runs the co-wear component against the asset-bundle-registry schema it reads in production (see
 * test/db/init-asset-bundle-registry-schema.sh), since nothing else here exercises the JSON, the URN
 * handling, the ranking or the partial index the query leans on.
 */
test('co-wear neighbours query', function ({ components }) {
  const HATS = '0x' + 'a'.repeat(40)
  const SHOES = '0x' + 'b'.repeat(40)
  const hat = `${HATS}-0`
  const jacket = `${HATS}-1`
  const boots = `${HATS}-2`
  const gloves = `${HATS}-3`
  const mask = `${HATS}-4`
  const cape = `${HATS}-5`
  const tie = `${SHOES}-0`
  const unlisted = `${SHOES}-1`
  const CATALOGUE = [hat, jacket, boots, gloves, mask, cape, tie, unlisted]
  const CANDIDATES = [hat, jacket, boots, gloves, mask, cape, tie]

  let profiles: Profile[]

  function wearing(count: number, wearables: (index: number) => unknown, timestamp: number, offset: number): Profile[] {
    return Array.from({ length: count }, (_, index) => ({
      pointer: `0x${(offset + index).toString(16).padStart(40, '0')}`,
      timestamp,
      metadata: { avatars: [{ avatar: { wearables: wearables(index) } }] }
    }))
  }

  async function insertProfiles(rows: Profile[]): Promise<void> {
    const pool = components.assetBundleRegistryDatabase.getPool()
    for (const [index, profile] of rows.entries()) {
      await pool.query(
        'INSERT INTO profiles (id, pointer, timestamp, content, metadata, local_timestamp) VALUES ($1, $2, $3, $4, $5, $3)',
        [`bafy-worn-${index}`, profile.pointer, profile.timestamp, '[]', JSON.stringify(profile.metadata)]
      )
    }
  }

  beforeEach(async () => {
    profiles = [
      // Worn together by five profiles, with token ids, mixed case, base wearables in both spellings and
      // a third-party item.
      ...wearing(
        5,
        index => [
          urn(HATS, 0, 100 + index),
          urn(HATS, 1).toUpperCase(),
          'urn:decentraland:off-chain:base-avatars:eyebrows_00',
          'dcl://base-avatars/brown_pants',
          'urn:decentraland:matic:collections-thirdparty:some-tp:collection:item'
        ],
        Date.now(),
        0
      ),
      // Below the support floor.
      ...wearing(4, () => [urn(HATS, 2), urn(HATS, 3)], Date.now(), 100),
      // Deployed long ago, which still counts.
      ...wearing(5, () => [urn(HATS, 4), urn(HATS, 5)], Date.parse('2022-01-01'), 200),
      // One side is not a candidate, the other is not catalogued at all.
      ...wearing(5, () => [urn(SHOES, 0), urn(SHOES, 1), urn(SHOES, 2)], Date.now(), 300),
      // Base wearables only, and wearables that are not an array: neither may break the scan.
      ...wearing(1, () => ['urn:decentraland:off-chain:base-avatars:eyebrows_00'], Date.now(), 400),
      ...wearing(1, () => 'oops', Date.now(), 500)
    ]
    await insertProfiles(profiles)
  })

  afterEach(async () => {
    await components.assetBundleRegistryDatabase
      .getPool()
      .query('DELETE FROM profiles WHERE pointer = ANY($1::text[])', [profiles.map(profile => profile.pointer)])
  })

  describe('when reading the co-wear neighbours', () => {
    let hatRows: WornNeighbor[]
    let shoeRows: WornNeighbor[]

    beforeEach(async () => {
      const rows: WornNeighbor[] = []
      for await (const batch of components.wornNeighbors.getNeighbors({ anchorIds: CATALOGUE, candidateIds: CANDIDATES })) {
        rows.push(...batch)
      }
      hatRows = rows.filter(row => row.itemId.startsWith(HATS))
      shoeRows = rows.filter(row => row.itemId.startsWith(SHOES))
    })

    it('should pair the items worn together in both directions, whenever the profiles were deployed', () => {
      expect(hatRows).toEqual([
        { itemId: hat, neighborId: jacket, sim: 1, support: 5, rank: 0 },
        { itemId: jacket, neighborId: hat, sim: 1, support: 5, rank: 0 },
        { itemId: mask, neighborId: cape, sim: 1, support: 5, rank: 0 },
        { itemId: cape, neighborId: mask, sim: 1, support: 5, rank: 0 }
      ])
    })

    it('should keep a non-candidate as an anchor but never as a neighbour, and skip what is not catalogued', () => {
      expect(shoeRows).toEqual([{ itemId: unlisted, neighborId: tie, sim: 1, support: 5, rank: 0 }])
    })
  })

  describe('when planning the co-wear query', () => {
    let plan: string

    beforeEach(async () => {
      // A test-sized table never picks an index on its own, whatever its predicate.
      const client = await components.assetBundleRegistryDatabase.getPool().connect()
      try {
        await client.query('SET enable_seqscan = off')
        const statement = buildCoWornQuery({ anchorIds: CATALOGUE, candidateIds: CANDIDATES })
        const { rows } = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${statement.text}`, statement.values)
        plan = rows.map(row => row['QUERY PLAN']).join('\n')
      } finally {
        await client.query('RESET enable_seqscan')
        client.release()
      }
    })

    it('should read the profiles through the registry partial index, which only matches an identical predicate', () => {
      expect(plan).toContain('idx_profiles_wearing_collections_v2')
    })
  })
})
