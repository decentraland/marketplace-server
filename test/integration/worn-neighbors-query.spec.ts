import { SELECT_CO_WORN } from '../../src/logic/suggestions/worn'
import { test } from '../components'

type WornRow = { item_id: string; neighbor_id: string; sim: number; support: string; rank: string }

function urn(contract: string, itemId: number, tokenId?: number): string {
  return `urn:decentraland:matic:collections-v2:${contract}:${itemId}${tokenId === undefined ? '' : `:${tokenId}`}`
}

/**
 * Runs the co-wear query against real Postgres, since its production home is the registry database and
 * nothing else here exercises the JSON, the URN handling or the ranking. `profiles` is a temporary table
 * mirroring the registry's columns: unqualified, the query resolves to it on this session.
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

  let hatRows: WornRow[]
  let shoeRows: WornRow[]

  async function run(profiles: { pointer: string; timestamp: number; metadata: unknown }[], catalogue: string[], candidates: string[]) {
    const client = await components.dappsWriteDatabase.getPool().connect()
    try {
      await client.query(
        'CREATE TEMP TABLE profiles (pointer varchar(255) PRIMARY KEY, timestamp bigint NOT NULL, metadata jsonb NOT NULL)'
      )
      for (const profile of profiles) {
        await client.query('INSERT INTO profiles (pointer, timestamp, metadata) VALUES ($1, $2, $3)', [
          profile.pointer,
          profile.timestamp,
          JSON.stringify(profile.metadata)
        ])
      }
      const result = await client.query<WornRow>(SELECT_CO_WORN, [catalogue, candidates])
      return result.rows
    } finally {
      await client.query('DROP TABLE IF EXISTS pg_temp.profiles')
      client.release()
    }
  }

  function wearing(count: number, wearables: (index: number) => unknown, timestamp = Date.now(), offset = 0) {
    return Array.from({ length: count }, (_, index) => ({
      pointer: `0x${(offset + index).toString(16).padStart(40, '0')}`,
      timestamp,
      metadata: { avatars: [{ avatar: { wearables: wearables(index) } }] }
    }))
  }

  beforeEach(async () => {
    const rows = await run(
      [
        // Worn together by five profiles, with token ids, mixed case and base wearables in both spellings.
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
        // A profile whose wearables are not an array must not break the scan.
        { pointer: `0x${'f'.repeat(40)}`, timestamp: Date.now(), metadata: { avatars: [{ avatar: { wearables: 'oops' } }] } }
      ],
      [hat, jacket, boots, gloves, mask, cape, tie, unlisted],
      [hat, jacket, boots, gloves, mask, cape, tie]
    )
    hatRows = rows.filter(row => row.item_id.startsWith(HATS))
    shoeRows = rows.filter(row => row.item_id.startsWith(SHOES))
  })

  it('should pair the items worn together in both directions, whenever the profiles were deployed', () => {
    expect(hatRows).toEqual([
      { item_id: hat, neighbor_id: jacket, sim: 1, support: '5', rank: '0' },
      { item_id: jacket, neighbor_id: hat, sim: 1, support: '5', rank: '0' },
      { item_id: mask, neighbor_id: cape, sim: 1, support: '5', rank: '0' },
      { item_id: cape, neighbor_id: mask, sim: 1, support: '5', rank: '0' }
    ])
  })

  it('should keep a non-candidate as an anchor but never as a neighbour, and skip what is not catalogued', () => {
    expect(shoeRows).toEqual([{ item_id: unlisted, neighbor_id: tie, sim: 1, support: '5', rank: '0' }])
  })
})
