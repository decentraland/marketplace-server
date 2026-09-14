import { getEthereumChainId, getPolygonChainId } from '../../logic/chainIds'
import {
  ALGORITHM_VERSION,
  CANDIDATE_MULTIPLIER,
  MAX_EQUIPPED,
  MAX_EXCLUDE,
  MAX_PROFILE_ITEMS,
  MAX_SEEDS,
  TASTE_CREATOR_COUNT,
  MIN_PERSONAL_ROWS,
  SUGGESTED_DEFAULT_LIMIT,
  SUGGESTED_MAX_LIMIT,
  SUGGESTIONS_CACHE_TTL_SECONDS
} from '../../logic/suggestions/constants'
import { buildProfileAggregates, buildTasteProfile, type ProfileItemAttributes } from '../../logic/suggestions/profile'
import { blendCandidates, rerankForDiversity, type ScoredCandidate } from '../../logic/suggestions/scoring'
import { normalizeItemIds, urnsToItemIds } from '../../logic/suggestions/urn'
import { DEFAULT_LIST_ID } from '../../migrations/favorites/1678303321034_default-list'
import { AppComponents } from '../../types'
import { buildItemUnifiedCore, clampCount, mapUnifiedItemRow, rateToNumericString } from '../shop-catalog/component'
import { SHOP_MIN_PAGE_SIZE, type RelatedItemRow } from '../shop-catalog/types'
import { buildCandidateScoresQuery, buildOwnedQuery, buildProfileAttributesQuery } from './queries'
import { ISuggestionsComponent, SuggestedItem, SuggestionsFilters, SuggestionsResult } from './types'

type CandidateRow = RelatedItemRow & {
  cf: number
  content: number
  popularity: number
  gender: string | null
  trigger_item_id: string | null
  trigger_source: string | null
}

type OwnedRow = { item_id: string; acquired_at: string; paid: boolean }

type AttributeRow = {
  item_id: string
  creator: string
  sub_category: string
  rarity: string
  price_credits: string
  is_wearable: boolean
}

/**
 * The "Suggested for you" rail.
 *
 * Three signals feed one score: what wallets who hold the same items also hold (co-ownership), what
 * resembles the profile by creator/collection/category/tags (content), and the wallet's aggregate
 * taste. A popularity prior breaks ties and fills. The first two come out of a table the neighbours
 * job precomputes; the last two are computed here, per request.
 *
 * Everything that can be returned is still gated by `buildItemUnifiedCore`, so this rail can never
 * advertise an item the browse grid would not sell, or at a price the grid would disagree with.
 */
export function createSuggestionsComponent(
  components: Pick<AppComponents, 'dappsDatabase' | 'shopCatalog' | 'lists' | 'cache' | 'logs'>
): ISuggestionsComponent {
  const { dappsDatabase: pg, shopCatalog, lists, cache, logs } = components
  const logger = logs.getLogger('suggestions')

  async function getOwned(address: string): Promise<OwnedRow[]> {
    const result = await pg.query<OwnedRow>(buildOwnedQuery(address))
    return result.rows
  }

  async function getFavorites(address: string): Promise<string[]> {
    try {
      const picks = await lists.getPicksByListId(DEFAULT_LIST_ID, { userAddress: address, limit: MAX_SEEDS, offset: 0 })
      return picks.map(pick => pick.item_id)
    } catch (error) {
      // The favorites DB is a separate store; losing it should cost the rail its explicit-like signal,
      // not the whole response.
      logger.warn(`Could not read favorites: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }

  async function getProfileAttributes(itemIds: string[]): Promise<Map<string, ProfileItemAttributes>> {
    if (itemIds.length === 0) return new Map()
    const result = await pg.query<AttributeRow>(buildProfileAttributesQuery(itemIds))
    return new Map(
      result.rows.map(row => [
        row.item_id,
        {
          itemId: row.item_id,
          creator: row.creator,
          subCategory: row.sub_category,
          rarity: row.rarity,
          priceCredits: Number(row.price_credits),
          isWearable: row.is_wearable
        }
      ])
    )
  }

  async function trendingFallback(filters: SuggestionsFilters, first: number, manaUsdRate: number): Promise<SuggestionsResult> {
    const { data } = await shopCatalog.getTrendingItems({ first, category: filters.category, includeSocialEmotes: false }, manaUsdRate)
    return {
      data: data.map(item => ({ ...item, reason: { kind: 'trending' as const }, score: 0 })),
      personalized: false,
      algorithm: ALGORITHM_VERSION
    }
  }

  async function getSuggestions(filters: SuggestionsFilters, manaUsdRate: number): Promise<SuggestionsResult> {
    const first = clampCount(filters.first, SUGGESTED_DEFAULT_LIMIT, SHOP_MIN_PAGE_SIZE, SUGGESTED_MAX_LIMIT)
    const address = filters.address?.toLowerCase()
    const seeds = normalizeItemIds(filters.seeds ?? [], MAX_SEEDS)
    const equipped = urnsToItemIds((filters.equipped ?? []).slice(0, MAX_EQUIPPED))
    const exclude = normalizeItemIds(filters.exclude ?? [], MAX_EXCLUDE)

    const cacheKey = buildCacheKey({ address, seeds, equipped, exclude, filters, first })
    const cached = await cache.get<SuggestionsResult>(cacheKey)
    if (cached) return cached

    const [owned, favorites] = await Promise.all([
      address ? getOwned(address) : Promise.resolve([] as OwnedRow[]),
      address ? getFavorites(address) : Promise.resolve([] as string[])
    ])

    const profile = buildTasteProfile({
      owned: owned.map(row => ({ itemId: row.item_id, paid: row.paid, acquiredAt: Number(row.acquired_at) })),
      favorites,
      equipped,
      seeds,
      now: Math.floor(Date.now() / 1000),
      limit: MAX_PROFILE_ITEMS
    })

    if (profile.length === 0) {
      const fallback = await trendingFallback(filters, first, manaUsdRate)
      await cache.set(cacheKey, fallback, SUGGESTIONS_CACHE_TTL_SECONDS)
      return fallback
    }

    const attributes = await getProfileAttributes(profile.map(entry => entry.itemId))
    const aggregates = buildProfileAggregates(profile, attributes)

    const core = buildItemUnifiedCore({ category: filters.category, includeSocialEmotes: false }, rateToNumericString(manaUsdRate))
    const result = await pg.query<CandidateRow>(
      buildCandidateScoresQuery({
        profile,
        core,
        ownedItemIds: owned.map(row => row.item_id),
        excludeItemIds: exclude,
        bodyShape: filters.bodyShape,
        topCreators: topCreatorsOf(aggregates.creatorAffinity),
        limit: first * CANDIDATE_MULTIPLIER
      })
    )

    if (result.rows.length < MIN_PERSONAL_ROWS) {
      const fallback = await trendingFallback(filters, first, manaUsdRate)
      await cache.set(cacheKey, fallback, SUGGESTIONS_CACHE_TTL_SECONDS)
      return fallback
    }

    const maxPopularity = Math.max(0, ...result.rows.map(row => Number(row.popularity)))
    const candidates: ScoredCandidate[] = result.rows.map(row => ({
      itemId: `${row.contract_address}-${row.item_id}`,
      contractAddress: row.contract_address,
      // A collections-v2 contract IS the collection, so the contract address is the collection key.
      collection: row.contract_address,
      creator: row.creator ?? '',
      subCategory: `${(row.item_type ?? '').startsWith('emote') ? 'emote' : 'wearable'}:${row.wearable_category ?? ''}`,
      rarity: (row.rarity ?? '').toLowerCase(),
      priceCredits: Number(row.price_credits),
      isWearable: !(row.item_type ?? '').startsWith('emote'),
      cf: Number(row.cf),
      content: Number(row.content),
      popularity: maxPopularity > 0 ? Number(row.popularity) / maxPopularity : 0,
      topTriggerItemId: row.trigger_item_id ?? undefined,
      topTriggerSource: (row.trigger_source as ScoredCandidate['topTriggerSource']) ?? undefined
    }))

    const blended = blendCandidates(candidates, aggregates)
    const ranked = rerankForDiversity(blended, first, aggregates.wearableRatio)

    const polygonChainId = getPolygonChainId()
    const ethereumChainId = getEthereumChainId()
    const byItemId = new Map(result.rows.map(row => [`${row.contract_address}-${row.item_id}`, row]))

    const data: SuggestedItem[] = []
    for (const candidate of ranked) {
      const row = byItemId.get(candidate.itemId)
      if (!row) continue
      data.push({
        ...mapUnifiedItemRow(row, polygonChainId, ethereumChainId),
        reason: candidate.reason,
        score: candidate.score
      })
    }

    const personalRows = data.filter(item => item.reason.kind !== 'trending').length
    const response: SuggestionsResult = {
      data,
      personalized: personalRows >= MIN_PERSONAL_ROWS,
      algorithm: ALGORITHM_VERSION
    }

    await cache.set(cacheKey, response, SUGGESTIONS_CACHE_TTL_SECONDS)
    return response
  }

  return { getSuggestions }
}

/** The creators the profile leans on hardest, which is what the taste branch of the query pulls from. */
function topCreatorsOf(creatorAffinity: Map<string, number>): string[] {
  return [...creatorAffinity.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TASTE_CREATOR_COUNT)
    .map(([creator]) => creator.toLowerCase())
}

/**
 * Cache key over everything that changes the answer. The seed and equipped lists are hashed rather
 * than spelled out: they are up to fifty ids, and a key that long is its own problem.
 */
function buildCacheKey(input: {
  address?: string
  seeds: string[]
  equipped: string[]
  exclude: string[]
  filters: SuggestionsFilters
  first: number
}): string {
  const parts = [
    input.address ?? 'anon',
    hashList(input.seeds),
    hashList(input.equipped),
    hashList(input.exclude),
    input.filters.bodyShape ?? '',
    input.filters.category ?? '',
    String(input.first)
  ]
  return `suggestions:${ALGORITHM_VERSION}:${parts.join(':')}`
}

/** FNV-1a over the sorted list. Not cryptographic — this only has to be stable and short. */
function hashList(values: string[]): string {
  if (values.length === 0) return '0'
  let hash = 0x811c9dc5
  for (const value of [...values].sort()) {
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    hash ^= 0x2c
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}
