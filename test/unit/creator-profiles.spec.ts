import {
  CatalystPayloadError,
  CREATOR_PROFILES_BATCH_SIZE,
  CatalystProfile,
  CreatorRow,
  getCreatorSearchQuery,
  parseCatalystProfiles,
  refreshCreatorProfiles
} from '../../src/logic/catalog/creator-profiles'

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`

function catalystEntry(id: string, overrides: Record<string, unknown> = {}) {
  return {
    timestamp: 1,
    avatars: [
      {
        name: `Creator ${id.slice(-2)}`,
        hasClaimedName: true,
        ethAddress: id,
        userId: id,
        avatar: { snapshots: { face256: `https://img.example/${id}/face.png` } },
        ...overrides
      }
    ]
  }
}

describe('when parsing a Catalyst profiles answer', () => {
  it('should take the name, whether it is claimed, and the face of the first avatar, with the address lowercased', () => {
    const profiles = parseCatalystProfiles([catalystEntry('0xABCDEF', { name: ' METATIGER ' })])

    expect(profiles).toEqual([
      { address: '0xabcdef', name: 'METATIGER', hasClaimedName: true, face: 'https://img.example/0xABCDEF/face.png' }
    ])
  })

  it('should refuse an entry without an avatar or without an address, so the batch is kept rather than blanked', () => {
    expect(() => parseCatalystProfiles([catalystEntry('0x1'), { avatars: [] }])).toThrow(CatalystPayloadError)
    expect(() => parseCatalystProfiles([{ avatars: [{ name: 'Nobody' }] }])).toThrow('entry 0 has no address')
    expect(() => parseCatalystProfiles([null])).toThrow('entry 0 has no avatar')
  })

  it('should accept an empty list: that is how Catalyst says it knows none of the addresses', () => {
    expect(parseCatalystProfiles([])).toEqual([])
  })

  it('should read an unclaimed or missing name as no name and a missing face as no face', () => {
    const profiles = parseCatalystProfiles([
      catalystEntry('0x1', { name: '   ', hasClaimedName: false, avatar: {} }),
      catalystEntry('0x2', { name: 'The1TheOnly', hasClaimedName: false })
    ])

    expect(profiles[0]).toEqual({ address: '0x1', name: null, hasClaimedName: false, face: null })
    expect(profiles[1].name).toEqual('The1TheOnly')
    expect(profiles[1].hasClaimedName).toBe(false)
  })

  it('should refuse a body that is not a list, such as an error object behind an HTTP 200', () => {
    expect(() => parseCatalystProfiles({ error: 'upstream temporary failure' })).toThrow(CatalystPayloadError)
    expect(() => parseCatalystProfiles(null)).toThrow('the body is not a list')
    expect(() => parseCatalystProfiles('[]')).toThrow(CatalystPayloadError)
  })
})

describe('when refreshing the creator profiles', () => {
  let query: jest.Mock
  let release: jest.Mock
  let fetchProfiles: jest.Mock
  let logger: { info: jest.Mock; warn: jest.Mock }
  let creators: CreatorRow[]

  const statements = () => query.mock.calls.map(([sql]) => sql as string)
  const payloadOf = (fragment: string) => {
    const call = query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes(fragment))
    return call ? JSON.parse(call[1][0] as string) : undefined
  }

  beforeEach(() => {
    creators = Array.from({ length: 250 }, (_, i) => ({
      address: address(i + 1),
      items: i + 1,
      collections: 1,
      names: i % 2 ? [`Name${i}`] : []
    }))
    query = jest.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] }
      if (sql.includes('WITH creators AS')) return { rows: creators }
      return { rows: [] }
    })
    release = jest.fn()
    fetchProfiles = jest.fn(
      async (addresses: string[]): Promise<CatalystProfile[]> =>
        addresses.map(a => ({ address: a, name: `Creator ${a.slice(-2)}`, hasClaimedName: true, face: null }))
    )
    logger = { info: jest.fn(), warn: jest.fn() }
    sleep = jest.fn().mockResolvedValue(undefined)
  })

  let sleep: jest.Mock
  const run = () => refreshCreatorProfiles({ connect: async () => ({ query, release }), fetchProfiles, logger, sleep })

  describe('and another instance holds the lock', () => {
    beforeEach(() => {
      query.mockImplementation(async (sql: string) =>
        sql.includes('pg_try_advisory_lock') ? { rows: [{ acquired: false }] } : { rows: [] }
      )
    })

    it('should step aside without calling Catalyst or writing anything, and hand the connection back', async () => {
      await expect(run()).resolves.toEqual({ outcome: 'skipped' })

      expect(fetchProfiles).not.toHaveBeenCalled()
      expect(statements()).not.toContain('BEGIN')
      expect(release).toHaveBeenCalledTimes(1)
    })
  })

  describe('and every Catalyst batch answers', () => {
    it('should look profiles up in batches and report what it did', async () => {
      await expect(run()).resolves.toEqual({ outcome: 'refreshed', creators: 250, lookedUp: 250, failedBatches: 0 })

      expect(fetchProfiles).toHaveBeenCalledTimes(3)
      expect(fetchProfiles.mock.calls.map(([batch]) => batch.length)).toEqual([
        CREATOR_PROFILES_BATCH_SIZE,
        CREATOR_PROFILES_BATCH_SIZE,
        50
      ])
    })

    it('should write every creator with their names and item count, then the looked-up profiles, then drop the rest, in one transaction', async () => {
      await run()

      const all = statements()
      const begin = all.indexOf('BEGIN')
      const upsert = all.findIndex(sql => sql.includes('INSERT INTO marketplace.creator_profiles'))
      const update = all.findIndex(sql => sql.includes('UPDATE marketplace.creator_profiles'))
      const remove = all.findIndex(sql => sql.includes('DELETE FROM marketplace.creator_profiles'))
      const commit = all.indexOf('COMMIT')
      expect([begin, upsert, update, remove, commit].every(i => i > -1)).toBe(true)
      expect(begin < upsert && upsert < update && update < remove && remove < commit).toBe(true)
      expect(all).not.toContain('ROLLBACK')

      expect(payloadOf('INSERT INTO marketplace.creator_profiles')).toHaveLength(250)
      expect(payloadOf('INSERT INTO marketplace.creator_profiles')[1]).toEqual({
        address: address(2),
        names: ['Name1'],
        items: 2,
        collections: 1
      })
      expect(payloadOf('UPDATE marketplace.creator_profiles')[0]).toEqual({
        address: address(1),
        name: 'Creator 01',
        has_claimed_name: true,
        face: null
      })
      const deleteCall = query.mock.calls.find(([sql]) => sql.includes('DELETE FROM marketplace.creator_profiles'))
      expect(deleteCall[1][0]).toEqual(creators.map(creator => creator.address))
    })

    it('should record an address Catalyst has no profile for as looked up and nameless', async () => {
      fetchProfiles.mockImplementation(async (addresses: string[]) =>
        addresses.filter(a => a !== address(3)).map(a => ({ address: a, name: 'Someone', hasClaimedName: true, face: null }))
      )

      await run()

      const row = payloadOf('UPDATE marketplace.creator_profiles').find((r: { address: string }) => r.address === address(3))
      expect(row).toEqual({ address: address(3), name: null, has_claimed_name: false, face: null })
    })

    it('should ignore a profile for an address it did not ask about', async () => {
      fetchProfiles.mockImplementation(async (addresses: string[]) => [
        ...addresses.map(a => ({ address: a, name: 'Someone', hasClaimedName: true, face: null })),
        { address: '0xstranger', name: 'Stranger', hasClaimedName: true, face: null }
      ])

      await run()

      expect(payloadOf('UPDATE marketplace.creator_profiles').some((r: { address: string }) => r.address === '0xstranger')).toBe(false)
    })

    it('should release the lock and the connection when it is done', async () => {
      await run()

      const all = statements()
      expect(all.some(sql => sql.includes('pg_advisory_unlock'))).toBe(true)
      expect(all.findIndex(sql => sql.includes('pg_advisory_unlock'))).toBeGreaterThan(all.indexOf('COMMIT'))
      expect(release).toHaveBeenCalledTimes(1)
    })
  })

  describe('and a Catalyst batch fails', () => {
    beforeEach(() => {
      fetchProfiles.mockImplementation(async (addresses: string[]) => {
        if (addresses[0] === address(101)) throw new Error('503 from Catalyst')
        return addresses.map(a => ({ address: a, name: 'Someone', hasClaimedName: true, face: null }))
      })
    })

    it('should try the batch again with a backoff before giving it up', async () => {
      await run()

      // three tries for the failing batch, one for each of the other two
      expect(fetchProfiles).toHaveBeenCalledTimes(5)
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 4000])
    })

    it('should keep going, leave that batch out of the profile update and still write names and counts for everyone', async () => {
      await expect(run()).resolves.toEqual({ outcome: 'refreshed', creators: 250, lookedUp: 150, failedBatches: 1 })

      expect(payloadOf('INSERT INTO marketplace.creator_profiles')).toHaveLength(250)
      const updated = payloadOf('UPDATE marketplace.creator_profiles').map((r: { address: string }) => r.address)
      expect(updated).toHaveLength(150)
      expect(updated).not.toContain(address(101))
      expect(updated).not.toContain(address(200))
      expect(updated).toContain(address(201))
      // two retries announced, then the batch given up
      expect(logger.warn).toHaveBeenCalledTimes(3)
      expect(logger.warn.mock.calls[2][0]).toContain('503 from Catalyst')
    })
  })

  describe('and the write fails', () => {
    beforeEach(() => {
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] }
        if (sql.includes('WITH creators AS')) return { rows: creators }
        if (sql.includes('UPDATE marketplace.creator_profiles')) throw new Error('statement timeout')
        return { rows: [] }
      })
    })

    it('should roll back, rethrow, and still release the lock and the connection', async () => {
      await expect(run()).rejects.toThrow('statement timeout')

      const all = statements()
      expect(all).toContain('ROLLBACK')
      expect(all).not.toContain('COMMIT')
      expect(all.some(sql => sql.includes('pg_advisory_unlock'))).toBe(true)
      expect(release).toHaveBeenCalledTimes(1)
    })
  })
})

describe('when building the creator search query', () => {
  it('should match the terms against the creator words under the trigram index, keeping the best hit per term', () => {
    const { text, values } = getCreatorSearchQuery('galaxy studio', 4)

    expect(text).toContain('FROM marketplace.creator_search_words AS w')
    expect(text).toContain('ON t.term <% w.word')
    // A name that merely CONTAINS the term is not a match: "duck" must not suggest the owner of STARDUCKS.
    expect(text).toContain('AND (starts_with(w.word, t.term) OR similarity(t.term, w.word) >= 0.5)')
    expect(text).toMatch(/MAX\(word_similarity\(t\.term, w\.word\)\)::float8 AS best/)
    expect(text).toContain('GROUP BY w.address, t.term')
    expect(values).toEqual(['galaxy studio', 'galaxy studio', 'galaxy studio', 4])
  })

  it('should rank by an explicit tier — exact, prefix, the rest — then score, then the bigger catalogue, then name and address', () => {
    const { text } = getCreatorSearchQuery('galaxy', 4)

    expect(text).toMatch(
      /FROM marketplace\.creator_search_names AS n\s+WHERE n\.address = p\.address\s+AND n\.sorted_words = q\.sorted_words\s*\) THEN 2\s+WHEN EXISTS/
    )
    expect(text).toMatch(/starts_with\(n\.phrase, q\.phrase\)\s*\) THEN 1\s+ELSE 0\s+END AS tier/)
    // never normalizing the names at request time: one creator holds three thousand
    expect(text).not.toContain('search_tokens(n.name)')
    // the tier is its own column, so exact beats prefix beats partial whatever the similarities sum to
    expect(text).toContain('ORDER BY tier DESC, h.score DESC, p.items DESC, COALESCE(p.name, p.names[1], p.address) ASC, p.address ASC')
  })

  it('should fall back to the creators matching the most terms only when none matches them all', () => {
    const { text } = getCreatorSearchQuery('galaxy wonderbot', 4)

    expect(text).toContain('WHERE h.matched = (SELECT MAX(matched) FROM search_hits)')
  })

  it('should show a creator under their profile name, their first NAME when the profile has none, or their address', () => {
    const { text } = getCreatorSearchQuery('wonderbot', 4)

    expect(text).toContain('COALESCE(p.name, p.names[1], p.address) AS name')
  })
})
