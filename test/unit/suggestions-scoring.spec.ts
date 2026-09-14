import { SCORE_WEIGHTS } from '../../src/logic/suggestions/constants'
import type { ProfileAggregates } from '../../src/logic/suggestions/profile'
import {
  blendCandidates,
  collectsCreator,
  pickReason,
  rerankForDiversity,
  type BlendedCandidate,
  type ScoredCandidate
} from '../../src/logic/suggestions/scoring'

function candidate(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    itemId: '0xaaa-1',
    contractAddress: '0xaaa',
    collection: '0xaaa',
    creator: '0xcreator',
    subCategory: 'wearable:hat',
    rarity: 'epic',
    priceCredits: 10,
    isWearable: true,
    cf: 0,
    content: 0,
    popularity: 0,
    ...overrides
  }
}

function emptyAggregates(overrides: Partial<ProfileAggregates> = {}): ProfileAggregates {
  return {
    creatorAffinity: new Map(),
    subCategoryAffinity: new Map(),
    rarityAffinity: new Map(),
    priceLow: 0,
    priceHigh: 0,
    wearableRatio: 0.7,
    ...overrides
  }
}

/** Score lookup that fails loudly if the candidate is missing, rather than asserting on undefined. */
function scoreOf(rows: BlendedCandidate[], itemId: string): number {
  const row = rows.find(entry => entry.itemId === itemId)
  if (!row) throw new Error(`no blended candidate for ${itemId}`)
  return row.score
}

describe('when blending candidate components', () => {
  describe('and the raw co-ownership scores run orders of magnitude above the others', () => {
    let blended: BlendedCandidate[]

    beforeEach(() => {
      blended = blendCandidates([candidate({ itemId: 'big', cf: 1000 }), candidate({ itemId: 'small', cf: 500 })], emptyAggregates())
    })

    it('should separate the two by the co-ownership weight applied to their ratio, not to their raw values', () => {
      expect(scoreOf(blended, 'big') - scoreOf(blended, 'small')).toBeCloseTo(SCORE_WEIGHTS.cf * 0.5, 6)
    })
  })

  describe('and two candidates differ only in a component that is weighted lower', () => {
    let blended: BlendedCandidate[]

    beforeEach(() => {
      blended = blendCandidates(
        [candidate({ itemId: 'cf-led', cf: 1, content: 0 }), candidate({ itemId: 'content-led', cf: 0, content: 1 })],
        emptyAggregates()
      )
    })

    it('should rank the co-ownership-led candidate above the content-led one', () => {
      expect(scoreOf(blended, 'cf-led')).toBeGreaterThan(scoreOf(blended, 'content-led'))
    })

    it('should separate them by the difference between the two published weights', () => {
      expect(scoreOf(blended, 'cf-led') - scoreOf(blended, 'content-led')).toBeCloseTo(SCORE_WEIGHTS.cf - SCORE_WEIGHTS.content, 6)
    })
  })

  describe('and a component is identical across every candidate', () => {
    let blended: BlendedCandidate[]

    beforeEach(() => {
      blended = blendCandidates(
        [candidate({ itemId: 'a', cf: 2, popularity: 0.4 }), candidate({ itemId: 'b', cf: 1, popularity: 0.4 })],
        emptyAggregates()
      )
    })

    it('should leave the ranking to the components that do vary', () => {
      expect(scoreOf(blended, 'a')).toBeGreaterThan(scoreOf(blended, 'b'))
    })
  })

  describe('and popularity is already normalised across the catalogue', () => {
    let blended: BlendedCandidate[]

    beforeEach(() => {
      blended = blendCandidates(
        [candidate({ itemId: 'popular', popularity: 1 }), candidate({ itemId: 'unpopular', popularity: 0 })],
        emptyAggregates()
      )
    })

    it('should use it as given rather than rescaling it against the other candidates', () => {
      expect(scoreOf(blended, 'popular') - scoreOf(blended, 'unpopular')).toBeCloseTo(SCORE_WEIGHTS.popularity, 6)
    })
  })
})

describe('when choosing the reason for a row', () => {
  describe('and co-ownership contributed most', () => {
    it('should name the profile item that pulled it', () => {
      const reason = pickReason(candidate({ topTriggerItemId: '0xbbb-2', topTriggerSource: 'owned' }), {
        cf: 0.4,
        content: 0.1,
        taste: 0.05,
        popularity: 0.01
      })
      expect(reason).toEqual({ kind: 'co_owned', itemId: '0xbbb-2' })
    })
  })

  describe('and the trigger item was a favorite', () => {
    it('should report it as similar to a favorite rather than as co-owned', () => {
      const reason = pickReason(candidate({ topTriggerItemId: '0xbbb-2', topTriggerSource: 'favorite' }), {
        cf: 0.4,
        content: 0.1,
        taste: 0,
        popularity: 0
      })
      expect(reason).toEqual({ kind: 'favorite_similar', itemId: '0xbbb-2' })
    })
  })

  describe('and the trigger item is being worn now', () => {
    it('should report it as going with what the avatar wears', () => {
      const reason = pickReason(candidate({ topTriggerItemId: '0xbbb-2', topTriggerSource: 'equipped' }), {
        cf: 0,
        content: 0.3,
        taste: 0,
        popularity: 0
      })
      expect(reason).toEqual({ kind: 'equipped_similar', itemId: '0xbbb-2' })
    })
  })

  describe('and aggregate taste contributed most', () => {
    describe('and the wallet really does collect that creator', () => {
      it('should attribute the row to the creator', () => {
        const reason = pickReason(candidate({ creator: '0xcreator' }), { cf: 0.05, content: 0.02, taste: 0.19, popularity: 0.01 }, true)
        expect(reason).toEqual({ kind: 'creator_affinity', creator: '0xcreator' })
      })
    })

    describe('and the taste match came from something other than the creator', () => {
      it('should fall back to the trigger rather than claim a creator the wallet never bought from', () => {
        const reason = pickReason(
          candidate({ creator: '0xstranger', topTriggerItemId: '0xbbb-2', topTriggerSource: 'owned' }),
          { cf: 0.05, content: 0.02, taste: 0.19, popularity: 0.01 },
          false
        )
        expect(reason).toEqual({ kind: 'co_owned', itemId: '0xbbb-2' })
      })

      it('should fall back to trending when there is no trigger to name either', () => {
        const reason = pickReason(candidate({ creator: '0xstranger' }), { cf: 0, content: 0, taste: 0.19, popularity: 0 }, false)
        expect(reason).toEqual({ kind: 'trending' })
      })
    })
  })

  describe('and the trigger item is only something the visitor looked at', () => {
    it('should not claim they have it', () => {
      const reason = pickReason(candidate({ topTriggerItemId: '0xbbb-2', topTriggerSource: 'seed' }), {
        cf: 0.4,
        content: 0.1,
        taste: 0,
        popularity: 0
      })
      expect(reason).toEqual({ kind: 'seed_similar', itemId: '0xbbb-2' })
    })
  })

  describe('and only popularity contributed', () => {
    it('should report the row as trending so it is not counted as personalised', () => {
      expect(pickReason(candidate(), { cf: 0, content: 0, taste: 0, popularity: 0.1 })).toEqual({ kind: 'trending' })
    })
  })

  describe('and co-ownership won but no trigger item was recorded', () => {
    it('should fall back to trending rather than claim an explanation it cannot name', () => {
      expect(pickReason(candidate(), { cf: 0.4, content: 0, taste: 0, popularity: 0 })).toEqual({ kind: 'trending' })
    })
  })
})

describe('when deciding whether a wallet collects a creator', () => {
  describe('and the profile holds two items by them', () => {
    it('should say it does', () => {
      expect(collectsCreator('0xcreator', new Map([['0xcreator', 2]]))).toBe(true)
    })
  })

  describe('and the profile holds only one', () => {
    it('should say it does not, because one purchase is not a pattern', () => {
      expect(collectsCreator('0xcreator', new Map([['0xcreator', 1]]))).toBe(false)
    })
  })

  describe('and the candidate has no creator at all', () => {
    it('should say it does not', () => {
      expect(collectsCreator('', new Map())).toBe(false)
    })
  })
})

describe('when re-ranking for diversity', () => {
  function blended(overrides: Partial<BlendedCandidate>): BlendedCandidate {
    return {
      ...candidate(),
      taste: 0,
      score: 1,
      reason: { kind: 'co_owned' as const },
      ...overrides
    }
  }

  describe('and one collection dominates the top of the ranking', () => {
    let ranked: BlendedCandidate[]

    beforeEach(() => {
      ranked = rerankForDiversity(
        [
          blended({ itemId: 'a-1', collection: '0xa', creator: '0xc1', subCategory: 'wearable:hat', score: 1.0 }),
          blended({ itemId: 'a-2', collection: '0xa', creator: '0xc2', subCategory: 'wearable:feet', score: 0.9 }),
          blended({ itemId: 'a-3', collection: '0xa', creator: '0xc3', subCategory: 'wearable:hat', score: 0.8 }),
          blended({ itemId: 'b-1', collection: '0xb', creator: '0xc4', subCategory: 'wearable:feet', score: 0.7 })
        ],
        3,
        1
      )
    })

    it('should cap that collection at two of the three slots', () => {
      expect(ranked.filter(row => row.collection === '0xa')).toHaveLength(2)
    })

    it('should still return a full rail by promoting the next collection', () => {
      expect(ranked.map(row => row.itemId)).toEqual(['a-1', 'a-2', 'b-1'])
    })
  })

  describe('and consecutive rows share a sub-category', () => {
    let ranked: BlendedCandidate[]

    beforeEach(() => {
      ranked = rerankForDiversity(
        [
          blended({ itemId: 'h-1', collection: '0xa', creator: '0xc1', subCategory: 'wearable:hat', score: 1.0 }),
          blended({ itemId: 'h-2', collection: '0xb', creator: '0xc2', subCategory: 'wearable:hat', score: 0.9 }),
          blended({ itemId: 'f-1', collection: '0xc', creator: '0xc3', subCategory: 'wearable:feet', score: 0.5 })
        ],
        3,
        1
      )
    })

    it('should break the run rather than show the same category twice in a row', () => {
      expect(ranked.map(row => row.subCategory)).toEqual(['wearable:hat', 'wearable:feet', 'wearable:hat'])
    })
  })

  describe('and the caps cannot be satisfied because supply is concentrated', () => {
    let ranked: BlendedCandidate[]

    beforeEach(() => {
      ranked = rerankForDiversity(
        [
          blended({ itemId: 'a-1', collection: '0xa', creator: '0xc1', subCategory: 'wearable:hat', score: 1.0 }),
          blended({ itemId: 'a-2', collection: '0xa', creator: '0xc1', subCategory: 'wearable:hat', score: 0.9 }),
          blended({ itemId: 'a-3', collection: '0xa', creator: '0xc1', subCategory: 'wearable:hat', score: 0.8 })
        ],
        3,
        1
      )
    })

    it('should fill the rail anyway, because a short rail is worse than a repetitive one', () => {
      expect(ranked).toHaveLength(3)
    })
  })

  describe('and the wallet collects mostly emotes', () => {
    let ranked: BlendedCandidate[]

    beforeEach(() => {
      ranked = rerankForDiversity(
        [
          blended({ itemId: 'w-1', collection: '0xa', creator: '0xc1', subCategory: 'wearable:hat', isWearable: true, score: 1.0 }),
          blended({ itemId: 'w-2', collection: '0xb', creator: '0xc2', subCategory: 'wearable:feet', isWearable: true, score: 0.9 }),
          blended({ itemId: 'e-1', collection: '0xc', creator: '0xc3', subCategory: 'emote:dance', isWearable: false, score: 0.4 }),
          blended({ itemId: 'e-2', collection: '0xd', creator: '0xc4', subCategory: 'emote:fun', isWearable: false, score: 0.3 })
        ],
        2,
        0.5
      )
    })

    it('should honour the mix instead of handing back only the two top-scoring wearables', () => {
      expect(ranked.filter(row => !row.isWearable)).toHaveLength(1)
    })
  })
})
