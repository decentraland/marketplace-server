import { PROFILE_WEIGHTS, RECENCY_DECAY_DAYS } from '../../src/logic/suggestions/constants'
import { buildProfileAggregates, buildTasteProfile, type ProfileItemAttributes } from '../../src/logic/suggestions/profile'

const NOW = 1_800_000_000
const DAY = 86400

describe('when building a taste profile', () => {
  describe('and the wallet holds one paid and one free item acquired today', () => {
    let profile: ReturnType<typeof buildTasteProfile>

    beforeEach(() => {
      profile = buildTasteProfile({
        owned: [
          { itemId: 'paid-1', paid: true, acquiredAt: NOW },
          { itemId: 'free-1', paid: false, acquiredAt: NOW }
        ],
        favorites: [],
        equipped: [],
        seeds: [],
        now: NOW
      })
    })

    it('should weight the free acquisition at the airdrop discount fixed by phase 0', () => {
      expect(profile.find(entry => entry.itemId === 'free-1')?.weight).toBeCloseTo(PROFILE_WEIGHTS.free, 6)
    })

    it('should weight the purchase at one', () => {
      expect(profile.find(entry => entry.itemId === 'paid-1')?.weight).toBeCloseTo(PROFILE_WEIGHTS.paid, 6)
    })
  })

  describe('and a purchase is exactly one decay period old', () => {
    let profile: ReturnType<typeof buildTasteProfile>

    beforeEach(() => {
      profile = buildTasteProfile({
        owned: [{ itemId: 'old', paid: true, acquiredAt: NOW - RECENCY_DECAY_DAYS * DAY }],
        favorites: [],
        equipped: [],
        seeds: [],
        now: NOW
      })
    })

    it('should decay its weight to 1/e', () => {
      expect(profile[0].weight).toBeCloseTo(Math.exp(-1), 6)
    })
  })

  describe('and the same item is owned, favorited and equipped', () => {
    let profile: ReturnType<typeof buildTasteProfile>

    beforeEach(() => {
      profile = buildTasteProfile({
        owned: [{ itemId: 'shared', paid: true, acquiredAt: NOW }],
        favorites: ['shared'],
        equipped: ['shared'],
        seeds: ['shared'],
        now: NOW
      })
    })

    it('should keep one entry rather than letting it accumulate across signals', () => {
      expect(profile).toHaveLength(1)
    })

    it('should keep the strongest signal, which is the equipped one', () => {
      expect(profile[0]).toEqual({ itemId: 'shared', weight: PROFILE_WEIGHTS.equipped, source: 'equipped' })
    })
  })

  describe('and the wallet holds far more items than the profile cap', () => {
    let profile: ReturnType<typeof buildTasteProfile>

    beforeEach(() => {
      profile = buildTasteProfile({
        owned: Array.from({ length: 1000 }, (_, i) => ({
          itemId: `item-${i}`,
          paid: i < 3,
          acquiredAt: NOW - i * DAY
        })),
        favorites: [],
        equipped: [],
        seeds: [],
        now: NOW
      })
    })

    it("should order by weight so the strongest signals survive the caller's cap", () => {
      expect(profile.slice(0, 3).map(entry => entry.itemId)).toEqual(['item-0', 'item-1', 'item-2'])
    })

    it('should rank every purchase above every airdrop', () => {
      const firstFree = profile.findIndex(entry => entry.weight < PROFILE_WEIGHTS.free)
      expect(profile.slice(0, 3).every(entry => entry.weight > profile[firstFree].weight)).toBe(true)
    })
  })

  describe('and there is no signal at all', () => {
    it('should return an empty profile so the caller can fall back to trending', () => {
      expect(buildTasteProfile({ owned: [], favorites: [], equipped: [], seeds: [], now: NOW })).toEqual([])
    })
  })
})

describe('when aggregating a profile', () => {
  let attributes: Map<string, ProfileItemAttributes>
  let aggregates: ReturnType<typeof buildProfileAggregates>

  beforeEach(() => {
    attributes = new Map([
      ['a', { itemId: 'a', creator: '0xcreator1', subCategory: 'wearable:hat', rarity: 'epic', priceCredits: 10, isWearable: true }],
      ['b', { itemId: 'b', creator: '0xcreator1', subCategory: 'wearable:hat', rarity: 'epic', priceCredits: 20, isWearable: true }],
      ['c', { itemId: 'c', creator: '0xcreator2', subCategory: 'emote:dance', rarity: 'rare', priceCredits: 30, isWearable: false }]
    ])
    aggregates = buildProfileAggregates(
      [
        { itemId: 'a', weight: 1, source: 'owned' },
        { itemId: 'b', weight: 1, source: 'owned' },
        { itemId: 'c', weight: 2, source: 'owned' }
      ],
      attributes
    )
  })

  it('should express creator affinity as a share of the total profile weight', () => {
    expect(aggregates.creatorAffinity.get('0xcreator1')).toBeCloseTo(0.5, 6)
  })

  it('should express the wearable ratio as a share of weight, not a count', () => {
    expect(aggregates.wearableRatio).toBeCloseTo(0.5, 6)
  })

  it('should take the interquartile price band from the prices present in the profile', () => {
    expect([aggregates.priceLow, aggregates.priceHigh]).toEqual([10, 20])
  })

  describe('and a profile item has no attributes resolved', () => {
    beforeEach(() => {
      aggregates = buildProfileAggregates([{ itemId: 'missing', weight: 5, source: 'seed' }], attributes)
    })

    it('should ignore it rather than divide by a total it did not contribute to', () => {
      expect(aggregates.creatorAffinity.size).toBe(0)
    })
  })
})
