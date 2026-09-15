import { getEthereumChainId, getPolygonChainId } from '../../logic/chainIds'
import {
  ALGORITHM_VERSION,
  CANDIDATE_MULTIPLIER,
  MAX_EQUIPPED,
  MAX_EXCLUDE,
  MAX_PROFILE_ITEMS,
  MAX_SEEDS,
  normalizeBodyShape,
  type BodyShape,
  type SuggestionCategory,
  normalizeCategory,
  PROFILE_SQL_LIMIT,
  TASTE_CREATOR_COUNT,
  MIN_PERSONAL_ROWS,
  SUGGESTED_DEFAULT_LIMIT,
  SUGGESTED_MAX_LIMIT,
  SUGGESTIONS_CACHE_TTL_SECONDS,
  SUGGESTIONS_MAX_CONCURRENT
} from '../../logic/suggestions/constants'
import { buildProfileAggregates, buildTasteProfile, type ProfileItemAttributes } from '../../logic/suggestions/profile'
import { blendCandidates, rerankForDiversity, type ScoredCandidate } from '../../logic/suggestions/scoring'
import { normalizeItemIds, urnsToItemIds } from '../../logic/suggestions/urn'
import { AppComponents } from '../../types'
import { buildItemUnifiedCore, clampCount, mapUnifiedItemRow, rateToNumericString } from '../shop-catalog/component'
import { SHOP_MIN_PAGE_SIZE, TRENDING_MAX_LIMIT, type RelatedItemRow } from '../shop-catalog/types'
import {
  buildCandidateContractsQuery,
  buildCandidateScoresQuery,
  buildOwnedAmongQuery,
  buildOwnedQuery,
  buildProfileAttributesQuery
} from './queries'
import { ISuggestionsComponent, SuggestedItem, SuggestionsFilters, SuggestionsResult } from './types'

type CandidateRow = RelatedItemRow & {
  cf: number
  content: number
  popularity: number
  gender: string | null
  trigger_item_id: string | null
  trigger_source: string | null
}

type OwnedRow = { item_id: string; acquired_at: string }

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
export async function createSuggestionsComponent(
  components: Pick<AppComponents, 'dappsDatabase' | 'shopCatalog' | 'cache' | 'logs' | 'config'>
): Promise<ISuggestionsComponent> {
  const { dappsDatabase: pg, shopCatalog, cache, logs, config } = components
  const logger = logs.getLogger('suggestions')
  const maxConcurrent = (await config.getNumber('SUGGESTIONS_MAX_CONCURRENT')) ?? SUGGESTIONS_MAX_CONCURRENT
  let inFlight = 0

  async function getOwned(address: string): Promise<OwnedRow[]> {
    const result = await pg.query<OwnedRow>(buildOwnedQuery(address, PROFILE_SQL_LIMIT))
    return result.rows
  }

  async function getOwnedAmong(address: string, itemIds: string[]): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set()
    const result = await pg.query<{ item_id: string }>(buildOwnedAmongQuery(address, itemIds))
    return new Set(result.rows.map(row => row.item_id))
  }

  async function getProfileAttributes(itemIds: string[], manaUsdRate: number): Promise<Map<string, ProfileItemAttributes>> {
    if (itemIds.length === 0) return new Map()
    const result = await pg.query<AttributeRow>(buildProfileAttributesQuery(itemIds, manaUsdRate))
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

  /**
   * The rail when there was nothing personal to say.
   *
   * It still honours the caller's hard filters. They are not personalisation -- "not this item" and
   * "not a shape this avatar can wear" are true whatever produced the rows, and the moment the rail
   * falls back is precisely when it would otherwise offer the PDP's own anchor item back to the
   * reader, or something they already have.
   *
   * The body shape is applied HERE rather than pushed into the catalogue query, because the catalogue's
   * `wearableGenders` asks a different question: it is `search_wearable_body_shapes @> ARRAY[shape]`,
   * which drops every item declaring no shape at all -- every emote, that is. Asking it for
   * `category=emote&bodyShape=BaseFemale` returns nothing, and the rail silently empties. Filtering the
   * rows on the `gender` the catalogue already reports reproduces the rule the scored query uses:
   * an emote plays on any body, an item with no declared shape is unisex by omission, and only the
   * OPPOSITE exclusive shape is incompatible.
   */
  async function trendingFallback(
    options: {
      first: number
      category?: SuggestionCategory
      bodyShape?: BodyShape
      excludeItemIds: string[]
      address?: string
    },
    manaUsdRate: number
  ): Promise<SuggestionsResult> {
    const { first, category, bodyShape, excludeItemIds, address } = options
    const excluded = new Set(excludeItemIds)
    // Every one of these drops rows after the query returns, so the query has to be asked for more than
    // the rail shows. The ceiling is the trending rail's own maximum -- asking past it is clamped there
    // anyway, so naming it keeps this from claiming headroom it never gets.
    const filtersRows = excluded.size > 0 || bodyShape !== undefined || address !== undefined
    const { data } = await shopCatalog.getTrendingItems(
      { first: filtersRows ? Math.min(first * 2, TRENDING_MAX_LIMIT) : first, category, includeSocialEmotes: false },
      manaUsdRate
    )

    const incompatible = bodyShape === 'BaseMale' ? 'female' : 'male'
    const candidates = data.filter(
      item => !excluded.has(`${item.contractAddress}-${item.itemId}`) && !(bodyShape !== undefined && item.gender === incompatible)
    )

    // Asked last, and only about what survived the free filters: it is the one filter that costs a
    // round trip, and the rows it would have judged are already gone.
    const owned = address
      ? await getOwnedAmong(
          address,
          candidates.map(item => `${item.contractAddress}-${item.itemId}`)
        )
      : new Set<string>()
    const rows = candidates.filter(item => !owned.has(`${item.contractAddress}-${item.itemId}`)).slice(0, first)

    return {
      data: rows.map(item => ({ ...item, reason: { kind: 'trending' as const }, score: 0 })),
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
    // Normalised BEFORE anything reads them, so the cache key and the query can never disagree about
    // what was asked. An unrecognised value collapses to "absent" rather than becoming a distinct key
    // for identical work — otherwise `?bodyShape=a`, `?bodyShape=b`, ... each miss the cache and each
    // run the full catalogue query.
    const bodyShape = normalizeBodyShape(filters.bodyShape)
    const category = normalizeCategory(filters.category)

    const cacheKey = buildCacheKey({ address, seeds, equipped, exclude, bodyShape, category, first })
    const cached = await cache.get<SuggestionsResult>(cacheKey)
    if (cached) return cached

    // Everything past here is database work. Shed rather than queue: an unbounded queue turns a burst
    // into a pool exhaustion that every other route pays for, and this rail is the one thing on the
    // page the Shop is happy to render without.
    if (inFlight >= maxConcurrent) {
      logger.warn(`suggestions shed: ${inFlight} computations already in flight`)
      return { data: [], personalized: false, algorithm: ALGORITHM_VERSION }
    }
    inFlight += 1
    try {
      return await compute()
    } finally {
      inFlight -= 1
    }

    async function compute(): Promise<SuggestionsResult> {
      const owned = address ? await getOwned(address) : []
      // What the fallback needs from this request, gathered once: every call site is a different reason
      // for falling back, and all of them owe the reader the same hard filters. The ADDRESS travels rather
      // than the profile's item ids: the profile is capped and paid-only, so using it as the owned set
      // would offer a gift, or anything held past the cap, back to its own owner.
      const fallbackOptions = { first, category, bodyShape, excludeItemIds: exclude, address }

      const profile = buildTasteProfile({
        owned: owned.map(row => ({ itemId: row.item_id, acquiredAt: Number(row.acquired_at) })),
        // No favourites, deliberately. They live behind a signature everywhere else in this service —
        // `lists.getPicksByListId` takes the caller's VERIFIED identity — and this endpoint is public and
        // unsigned, so reading them for a `?address=` anyone can type would let one person enumerate
        // another's favourites through the `favorite_similar` reasons it hands back. The spec's argument
        // for leaving the endpoint unsigned was that ownership is already public through /v1/nfts?owner=;
        // that is true of ownership and does not extend to favourites. `buildTasteProfile` still supports
        // them, so they return as one line here once this endpoint has a verified identity to read with.
        favorites: [],
        equipped,
        seeds,
        now: Math.floor(Date.now() / 1000),
        limit: MAX_PROFILE_ITEMS
      })

      if (profile.length === 0) {
        const fallback = await trendingFallback(fallbackOptions, manaUsdRate)
        await cache.set(cacheKey, fallback, SUGGESTIONS_CACHE_TTL_SECONDS)
        return fallback
      }

      const attributes = await getProfileAttributes(
        profile.map(entry => entry.itemId),
        manaUsdRate
      )
      const aggregates = buildProfileAggregates(profile, attributes)

      const topCreators = topCreatorsOf(aggregates.creatorAffinity)

      // Resolve the candidates' collections first so the core can be built narrow: 25 ms here saves
      // ~410 ms there, and nothing outside these collections could be recommended anyway. An empty
      // result therefore means there is nothing to rank, not that the query went wrong.
      const contractRows = await pg.query<{ contract: string }>(buildCandidateContractsQuery(profile, topCreators))
      const contractAddresses = contractRows.rows.map(row => row.contract).filter(Boolean)
      if (contractAddresses.length === 0) {
        const fallback = await trendingFallback(fallbackOptions, manaUsdRate)
        await cache.set(cacheKey, fallback, SUGGESTIONS_CACHE_TTL_SECONDS)
        return fallback
      }

      const core = buildItemUnifiedCore({ category, includeSocialEmotes: false, contractAddresses }, rateToNumericString(manaUsdRate))
      const result = await pg.query<CandidateRow>(
        buildCandidateScoresQuery({
          profile,
          core,
          address,
          excludeItemIds: exclude,
          bodyShape,
          topCreators,
          limit: first * CANDIDATE_MULTIPLIER
        })
      )

      if (result.rows.length < MIN_PERSONAL_ROWS) {
        const fallback = await trendingFallback(fallbackOptions, manaUsdRate)
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

      // How many profile items each creator accounts for, which is what lets a row claim the wallet
      // collects that creator rather than merely matching its taste on some other axis.
      const profileCreatorCounts = new Map<string, number>()
      for (const entry of profile) {
        const creator = attributes.get(entry.itemId)?.creator
        if (creator) profileCreatorCounts.set(creator, (profileCreatorCounts.get(creator) ?? 0) + 1)
      }

      const blended = blendCandidates(candidates, aggregates, profileCreatorCounts)
      const ranked = rerankForDiversity(blended, first, aggregates.wearableRatio)

      const polygonChainId = getPolygonChainId()
      const ethereumChainId = getEthereumChainId()
      const byItemId = new Map(result.rows.map(row => [`${row.contract_address}-${row.item_id}`, row]))

      const data: SuggestedItem[] = []
      for (const candidate of ranked) {
        const row = byItemId.get(candidate.itemId)
        if (!row) continue
        data.push({
          ...mapUnifiedItemRow(row, polygonChainId, ethereumChainId, message => logger.warn(message)),
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
 * Cache key over everything the CALLER changes. The MANA/USD rate is deliberately absent: it moves
 * continuously, so including it would make the cache miss almost every time, and a rate change inside
 * the ten-minute window only shifts credit prices by rounding. The browse grid caches on the same
 * terms, so the two cannot disagree by more than that either. The seed and equipped lists are hashed rather
 * than spelled out: they are up to fifty ids, and a key that long is its own problem.
 */
function buildCacheKey(input: {
  address?: string
  seeds: string[]
  equipped: string[]
  exclude: string[]
  bodyShape?: string
  category?: string
  first: number
}): string {
  const parts = [
    input.address ?? 'anon',
    hashList(input.seeds),
    hashList(input.equipped),
    hashList(input.exclude),
    input.bodyShape ?? '',
    input.category ?? '',
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
