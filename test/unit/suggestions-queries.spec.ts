import SQL from 'sql-template-strings'
import type { ProfileEntry } from '../../src/logic/suggestions/profile'
import { buildCandidateContractsQuery, buildCandidateScoresQuery, buildOwnedQuery } from '../../src/ports/suggestions/queries'

describe('when asking what the wallet bought', () => {
  let query: ReturnType<typeof buildOwnedQuery>

  beforeEach(() => {
    query = buildOwnedQuery('0xwallet', 400)
  })

  // Whether this SQL is VALID is settled by test/integration/suggestions-queries.spec.ts, which runs it
  // against a real Postgres. Asserting on the text here can only describe intent, never correctness.
  it('should require a matching sale, so an item the wallet was given never reaches the profile', () => {
    expect(query.text).toContain('WHERE EXISTS')
  })

  it('should not need a DISTINCT, which would forbid ordering by the decay expression', () => {
    expect(query.text).not.toContain('DISTINCT')
  })

  it('should look the holdings up by the indexed column, without wrapping it', () => {
    expect(query.text).toContain('n.owner_address = $')
  })

  it('should cap how many rows it ships, so the largest holder does not send its whole collection', () => {
    expect(query.values).toContain(400)
  })

  it('should order by recency, which is all that separates purchases once they all weigh the same', () => {
    expect(query.text).toContain('ORDER BY exp(')
  })
})

describe('when resolving which collections the candidates live in', () => {
  let profile: ProfileEntry[]

  beforeEach(() => {
    profile = [{ itemId: '0xaaa-1', weight: 1, source: 'owned' }]
  })

  it('should look the neighbours up by the indexed column', () => {
    expect(buildCandidateContractsQuery(profile, []).text).toContain('n.item_id = ANY($')
  })

  it('should bind the profile ids rather than interpolate them', () => {
    expect(buildCandidateContractsQuery(profile, []).values).toContainEqual(['0xaaa-1'])
  })

  it('should only follow the weighted neighbour sources', () => {
    expect(buildCandidateContractsQuery(profile, []).values).toContainEqual(['cf', 'content'])
  })

  describe('and the profile leans on particular creators', () => {
    it('should include their collections too, so narrowing the core cannot delete the creator branch', () => {
      expect(buildCandidateContractsQuery(profile, ['0xcreator']).text).toContain('UNION')
    })
  })

  describe('and the profile leans on no creator in particular', () => {
    it('should ask only about the neighbours', () => {
      expect(buildCandidateContractsQuery(profile, []).text).not.toContain('UNION')
    })
  })
})

describe('when building the candidate scores query', () => {
  let profile: ProfileEntry[]

  function build(overrides: Partial<Parameters<typeof buildCandidateScoresQuery>[0]> = {}) {
    return buildCandidateScoresQuery({
      profile,
      core: SQL`SELECT 1 AS usd_wei`,
      excludeItemIds: [],
      topCreators: [],
      limit: 36,
      ...overrides
    })
  }

  beforeEach(() => {
    profile = [{ itemId: '0xaaa-1', weight: 1, source: 'owned' }]
  })

  describe('and the caller sends a body shape', () => {
    describe('and it is BaseFemale', () => {
      it('should exclude only the wearables that declare the male shape exclusively', () => {
        expect(build({ bodyShape: 'BaseFemale' }).values).toContain('male')
      })
    })

    describe('and it is BaseMale', () => {
      it('should exclude only the wearables that declare the female shape exclusively', () => {
        expect(build({ bodyShape: 'BaseMale' }).values).toContain('female')
      })
    })

    describe('and it is something the avatar system does not define', () => {
      it('should ignore it rather than filter on a shape no item declares', () => {
        expect(build({ bodyShape: 'BaseAlien' }).text).not.toContain('core.gender')
      })
    })

    describe('and it is absent', () => {
      it('should not filter on body shape at all, so unisex and emotes are unaffected', () => {
        expect(build().text).not.toContain('core.gender')
      })
    })
  })

  describe('and the caller is a known wallet', () => {
    let query: ReturnType<typeof build>

    beforeEach(() => {
      query = build({ address: '0xwallet' })
    })

    it('should exclude every holding through an anti-join rather than shipping the ids back as an array', () => {
      expect(query.text).toContain('NOT EXISTS (SELECT 1 FROM owned o')
    })

    it('should materialise the holdings once instead of re-probing them per candidate', () => {
      expect(query.text).toContain('owned AS MATERIALIZED')
    })

    it('should look the holdings up by the indexed column, without wrapping it', () => {
      expect(query.text).toContain('n.owner_address = $')
    })

    it('should exclude everything the wallet holds, bought or not, because owning it is reason enough', () => {
      const ownedCte = query.text.slice(query.text.indexOf('owned AS MATERIALIZED'), query.text.indexOf('profile(item_id'))
      expect(ownedCte).not.toContain('sale')
    })
  })

  describe('and the caller is anonymous', () => {
    it('should not build an exclusion at all, because it knows of nothing they own', () => {
      expect(build().text).not.toContain('owned AS MATERIALIZED')
    })
  })

  describe('and the caller excludes an anchor item', () => {
    it('should keep it out of the rail', () => {
      const query = build({ excludeItemIds: ['0xccc-9'] })
      expect(query.values).toContainEqual(['0xccc-9'])
    })
  })

  describe('and the profile leans on particular creators', () => {
    let text: string

    beforeEach(() => {
      text = build({ topCreators: ['0xcreator1', '0xcreator2'] }).text
    })

    it('should add a second branch for their catalogue', () => {
      expect(text).toContain('UNION')
    })

    it('should cap how much of each creator it pulls in', () => {
      expect(text).toContain('creator_rank <=')
    })

    it('should rank that branch by recency, so it surfaces new drops', () => {
      expect(text).toContain('PARTITION BY lower(core.creator) ORDER BY core.created_at DESC')
    })
  })

  describe('and the profile leans on no creator in particular', () => {
    it('should leave the second branch out entirely', () => {
      expect(build({ topCreators: [] }).text).not.toContain('UNION')
    })
  })

  describe('and the neighbour branch is ranked', () => {
    it('should weight co-ownership above content and co-wear, matching the published blend', () => {
      expect(build().text).toContain('(cf * 0.45 + content * 0.25 + worn * 0)')
    })

    it('should limit it, so the creator branch cannot be starved by neighbours', () => {
      expect(build({ limit: 36 }).values).toContain(36)
    })
  })

  describe('and a neighbour source carries no weight yet', () => {
    it('should read only the weighted sources, so the unweighted one does not widen the candidates', () => {
      expect(build().values).toContainEqual(['cf', 'content'])
    })
  })

  describe('and the profile carries several signals', () => {
    beforeEach(() => {
      profile = [
        { itemId: '0xaaa-1', weight: 1.5, source: 'equipped' },
        { itemId: '0xbbb-2', weight: 0.8, source: 'seed' }
      ]
    })

    it('should bind every profile item and its weight, so nothing reaches SQL as text', () => {
      const query = build()
      expect(query.values).toEqual(expect.arrayContaining(['0xaaa-1', 1.5, 'equipped', '0xbbb-2', 0.8, 'seed']))
    })

    it('should carry the source through, which is what turns a row into the right reason', () => {
      expect(build().text).toContain('trigger_source')
    })
  })
})
