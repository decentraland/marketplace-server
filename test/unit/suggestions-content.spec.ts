import { CONTENT_WEIGHTS } from '../../src/logic/suggestions/constants'
import { assignPriceBands, buildContentNeighbors, buildTagVectors, type ContentItem } from '../../src/logic/suggestions/content'

function item(overrides: Partial<ContentItem> & { index: number }): ContentItem {
  return {
    creator: '',
    collection: '',
    subCategory: '',
    rarityTier: -1,
    priceBand: -1,
    isCandidate: true,
    tags: new Uint32Array(0),
    tagWeights: new Float32Array(0),
    ...overrides
  }
}

function simBetween(rows: ReturnType<typeof buildContentNeighbors>, anchor: number, neighbor: number): number | undefined {
  return rows.find(row => row.item === anchor && row.neighbor === neighbor)?.sim
}

describe('when building content neighbours', () => {
  describe('and two items share only their creator', () => {
    let rows: ReturnType<typeof buildContentNeighbors>

    beforeEach(() => {
      rows = buildContentNeighbors([item({ index: 0, creator: '0xa' }), item({ index: 1, creator: '0xa' })])
    })

    it('should score the pair at the creator weight alone', () => {
      expect(simBetween(rows, 0, 1)).toBeCloseTo(CONTENT_WEIGHTS.creator, 6)
    })
  })

  describe('and two items share creator, collection and sub-category', () => {
    let rows: ReturnType<typeof buildContentNeighbors>

    beforeEach(() => {
      const shared = { creator: '0xa', collection: '0xc', subCategory: 'wearable:hat' }
      rows = buildContentNeighbors([item({ index: 0, ...shared }), item({ index: 1, ...shared })])
    })

    it('should add the three weights together', () => {
      expect(simBetween(rows, 0, 1)).toBeCloseTo(CONTENT_WEIGHTS.creator + CONTENT_WEIGHTS.collection + CONTENT_WEIGHTS.subCategory, 6)
    })
  })

  describe('and two items sit one rarity tier apart', () => {
    let rows: ReturnType<typeof buildContentNeighbors>

    beforeEach(() => {
      rows = buildContentNeighbors([item({ index: 0, creator: '0xa', rarityTier: 3 }), item({ index: 1, creator: '0xa', rarityTier: 4 })])
    })

    it('should still credit the rarity match, because rarity is an ordered scale', () => {
      expect(simBetween(rows, 0, 1)).toBeCloseTo(CONTENT_WEIGHTS.creator + CONTENT_WEIGHTS.rarity, 6)
    })
  })

  describe('and two items sit three rarity tiers apart', () => {
    let rows: ReturnType<typeof buildContentNeighbors>

    beforeEach(() => {
      rows = buildContentNeighbors([item({ index: 0, creator: '0xa', rarityTier: 1 }), item({ index: 1, creator: '0xa', rarityTier: 4 })])
    })

    it('should not credit the rarity match', () => {
      expect(simBetween(rows, 0, 1)).toBeCloseTo(CONTENT_WEIGHTS.creator, 6)
    })
  })

  describe('and a candidate resembles the anchor only through rarity and price band', () => {
    let rows: ReturnType<typeof buildContentNeighbors>

    beforeEach(() => {
      rows = buildContentNeighbors([
        item({ index: 0, creator: '0xa', rarityTier: 2, priceBand: 1 }),
        item({ index: 1, creator: '0xb', rarityTier: 2, priceBand: 1 })
      ])
    })

    it('should leave it out, since the pool is what makes the pass affordable', () => {
      expect(simBetween(rows, 0, 1)).toBeUndefined()
    })
  })

  describe('and a neighbour is not a candidate', () => {
    let rows: ReturnType<typeof buildContentNeighbors>

    beforeEach(() => {
      rows = buildContentNeighbors([item({ index: 0, creator: '0xa' }), item({ index: 1, creator: '0xa', isCandidate: false })])
    })

    it('should never store a row pointing at it', () => {
      expect(simBetween(rows, 0, 1)).toBeUndefined()
    })
  })

  describe('and a tag is carried by more items than the document-frequency cap allows', () => {
    let withCommonTag: ReturnType<typeof buildContentNeighbors>

    beforeEach(() => {
      const tags = Uint32Array.from([7])
      const weights = Float32Array.from([1])
      const items = Array.from({ length: 5 }, (_, index) => item({ index, creator: `0x${index}`, tags, tagWeights: weights }))
      withCommonTag = buildContentNeighbors(items, { maxTagDocumentFrequency: 3 })
    })

    it('should ignore it, because a tag on everything discriminates nothing', () => {
      expect(withCommonTag).toEqual([])
    })
  })

  describe('and two items share a rare tag', () => {
    let rows: ReturnType<typeof buildContentNeighbors>

    beforeEach(() => {
      const tags = Uint32Array.from([7])
      const weights = Float32Array.from([1])
      rows = buildContentNeighbors([
        item({ index: 0, creator: '0xa', tags, tagWeights: weights }),
        item({ index: 1, creator: '0xb', tags, tagWeights: weights })
      ])
    })

    it('should pair them on the tag alone', () => {
      expect(simBetween(rows, 0, 1)).toBeCloseTo(CONTENT_WEIGHTS.tags, 6)
    })
  })
})

describe('when assigning price bands', () => {
  let bands: Map<number, number>

  beforeEach(() => {
    bands = assignPriceBands([
      { index: 0, subCategory: 'wearable:hat', price: 1 },
      { index: 1, subCategory: 'wearable:hat', price: 10 },
      { index: 2, subCategory: 'wearable:hat', price: 100 },
      { index: 3, subCategory: 'wearable:hat', price: 1000 }
    ])
  })

  it('should put the cheapest item in the lowest band', () => {
    expect(bands.get(0)).toBe(0)
  })

  it('should put the dearest item in the highest band', () => {
    expect(bands.get(3)).toBe(3)
  })

  describe('and an item has no price', () => {
    beforeEach(() => {
      bands = assignPriceBands([{ index: 0, subCategory: 'wearable:hat', price: 0 }])
    })

    it('should leave it unbanded rather than calling it cheap', () => {
      expect(bands.has(0)).toBe(false)
    })
  })

  describe('and two items of different sub-categories cost the same', () => {
    beforeEach(() => {
      bands = assignPriceBands([
        { index: 0, subCategory: 'wearable:hat', price: 100 },
        { index: 1, subCategory: 'wearable:hat', price: 200 },
        { index: 2, subCategory: 'emote:dance', price: 10 },
        { index: 3, subCategory: 'emote:dance', price: 100 }
      ])
    })

    it('should band each within its own sub-category, so "expensive" means expensive for that kind', () => {
      expect(bands.get(0)).not.toBe(bands.get(3))
    })
  })
})

describe('when building tag vectors', () => {
  let vectors: ReturnType<typeof buildTagVectors>

  beforeEach(() => {
    vectors = buildTagVectors(new Map([[0, [0, 1]]]), [1, 500], 1000)
  })

  it('should produce a unit-length vector so the dot product is a cosine', () => {
    const vector = vectors.get(0)
    expect(Math.hypot(vector?.weights[0] ?? 0, vector?.weights[1] ?? 0)).toBeCloseTo(1, 5)
  })

  it('should weight the rare tag above the common one', () => {
    const vector = vectors.get(0)
    expect(vector?.weights[0]).toBeGreaterThan(vector?.weights[1] ?? 0)
  })
})
