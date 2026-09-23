import { getEthereumChainId, getPolygonChainId } from '../../logic/chainIds'
import {
  ALGORITHM_VERSION,
  CANDIDATE_MULTIPLIER,
  MAX_EQUIPPED,
  MAX_EXCLUDE,
  MAX_PROFILE_ITEMS,
  MAX_FAVORITES,
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
  SUGGESTIONS_MAX_CONCURRENT,
  SHED_LOG_INTERVAL_MS
} from '../../logic/suggestions/constants'
import { buildProfileAggregates, buildTasteProfile, type ProfileItemAttributes } from '../../logic/suggestions/profile'
import { blendCandidates, rerankForDiversity, type ScoredCandidate } from '../../logic/suggestions/scoring'
import { normalizeItemIds, toItemIds } from '../../logic/suggestions/urn'
import { DEFAULT_LIST_ID } from '../../migrations/favorites/1678303321034_default-list'
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
  worn: number
  popularity: number
  gender: string | null
  trigger_item_id: string | null
  trigger_source: string | null
  worn_trigger_item_id: string | null
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
  components: Pick<AppComponents, 'dappsDatabase' | 'shopCatalog' | 'lists' | 'cache' | 'logs' | 'config'>
): Promise<ISuggestionsComponent> {
  const { dappsDatabase: pg, shopCatalog, lists, cache, logs, config } = components
  const logger = logs.getLogger('suggestions')
  // Validated rather than trusted: a misconfigured 0 or -1 would shed EVERY request and leave the rail
  // permanently empty, which looks exactly like the feature being off rather than like a broken setting.
  const configured = await config.getNumber('SUGGESTIONS_MAX_CONCURRENT')
  const maxConcurrent = Number.isInteger(configured) && (configured as number) > 0 ? (configured as number) : SUGGESTIONS_MAX_CONCURRENT
  if (configured !== undefined && configured !== maxConcurrent) {
    logger.warn(`SUGGESTIONS_MAX_CONCURRENT must be a positive integer, got ${configured}; using ${maxConcurrent}`)
  }
  let inFlight = 0
  let shedTotal = 0
  let shedLoggedAt = 0

  async function getOwned(address: string): Promise<OwnedRow[]> {
    const result = await pg.query<OwnedRow>(buildOwnedQuery(address, PROFILE_SQL_LIMIT))
    return result.rows
  }

  /**
   * The caller's own favourites, and only ever their own.
   *
   * Read for the address the signature PROVED, never for the `?address=` query parameter -- reading them
   * for an address anyone can type is exactly the hole this endpoint had, because the rail hands back
   * `favorite_similar` reasons that name the items. When the two disagree the favourites are dropped
   * rather than mixed: a rail built from one person's holdings and another's favourites belongs to
   * nobody, and the caller can always ask again without the mismatch.
   */
  async function getFavorites(verifiedAddress: string): Promise<string[]> {
    try {
      const picks = await lists.getPicksByListId(DEFAULT_LIST_ID, { userAddress: verifiedAddress, limit: MAX_FAVORITES, offset: 0 })
      return picks.map(pick => pick.item_id)
    } catch (error) {
      // A separate store: losing it should cost the rail one signal, not the whole response.
      logger.warn(`Could not read favorites: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
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
    const equipped = toItemIds(filters.equipped ?? [], MAX_EQUIPPED)
    const exclude = normalizeItemIds(filters.exclude ?? [], MAX_EXCLUDE)
    // Normalised BEFORE anything reads them, so the cache key and the query can never disagree about
    // what was asked. An unrecognised value collapses to "absent" rather than becoming a distinct key
    // for identical work — otherwise `?bodyShape=a`, `?bodyShape=b`, ... each miss the cache and each
    // run the full catalogue query.
    const bodyShape = normalizeBodyShape(filters.bodyShape)
    const category = normalizeCategory(filters.category)
    // Favourites are read only when the proven identity IS the wallet the rail is being built for. An
    // anonymous caller has none to read, and a caller asking about SOMEONE ELSE gets the public half of
    // that someone else and no favourites at all -- mixing one person's holdings with another's saved
    // items produces a rail belonging to neither, and the mismatch is always the caller's to resolve.
    const verifiedAddress = filters.verifiedAddress?.toLowerCase()
    const favoritesFor = verifiedAddress && (!address || address === verifiedAddress) ? verifiedAddress : undefined
    // A caller who signed and named nobody means themselves. Without this the request reads their
    // favourites but not their holdings, and recommends back items they already own -- a rail assembled
    // from half an identity, which is worse than either half alone.
    const profileFor = address ?? verifiedAddress

    const cacheKey = buildCacheKey({ address: profileFor, favoritesFor, seeds, equipped, exclude, bodyShape, category, first })
    const cached = await cache.get<SuggestionsResult>(cacheKey)
    if (cached) return cached

    // Everything past here is database work. Shed rather than queue: an unbounded queue turns a burst
    // into a pool exhaustion that every other route pays for, and this rail is the one thing on the
    // page the Shop is happy to render without.
    if (inFlight >= maxConcurrent) {
      // Saturation arrives as a burst by definition, so one line per shed request is a flood on top of a
      // flood. The count is CUMULATIVE rather than per-window: a window that ends before its line is
      // printed would otherwise take its sheds with it, and a total that only ever grows is also the
      // shape a counter metric wants if this is ever promoted to one.
      shedTotal += 1
      const now = Date.now()
      if (now - shedLoggedAt >= SHED_LOG_INTERVAL_MS) {
        logger.warn(`suggestions shed ${shedTotal} request(s) since start: ${inFlight} computations already in flight`)
        shedLoggedAt = now
      }
      return { data: [], personalized: false, algorithm: ALGORITHM_VERSION }
    }
    inFlight += 1
    try {
      return await compute()
    } finally {
      inFlight -= 1
    }

    async function compute(): Promise<SuggestionsResult> {
      const [owned, favorites] = await Promise.all([
        profileFor ? getOwned(profileFor) : Promise.resolve([] as OwnedRow[]),
        favoritesFor ? getFavorites(favoritesFor) : Promise.resolve([] as string[])
      ])
      // What the fallback needs from this request, gathered once: every call site is a different reason
      // for falling back, and all of them owe the reader the same hard filters. The ADDRESS travels rather
      // than the profile's item ids: the profile is capped and paid-only, so using it as the owned set
      // would offer a gift, or anything held past the cap, back to its own owner.
      const fallbackOptions = { first, category, bodyShape, excludeItemIds: exclude, address: profileFor }

      const profile = buildTasteProfile({
        owned: owned.map(row => ({ itemId: row.item_id, acquiredAt: Number(row.acquired_at) })),
        // Empty unless the caller signed: see getFavorites for why `?address=` is not enough.
        favorites,
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
          address: profileFor,
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
        worn: Number(row.worn),
        popularity: maxPopularity > 0 ? Number(row.popularity) / maxPopularity : 0,
        topTriggerItemId: row.trigger_item_id ?? undefined,
        topTriggerSource: (row.trigger_source as ScoredCandidate['topTriggerSource']) ?? undefined,
        topWornTriggerItemId: row.worn_trigger_item_id ?? undefined
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
  /**
   * Part of the key, and load-bearing. Without it a signed answer -- which carries `favorite_similar`
   * reasons naming what the caller saved -- and an unsigned one for the same `?address=` collide on one
   * entry, and whoever asks second reads the first one's favourites out of the cache. That is the same
   * leak the signature exists to close, arriving by a different door.
   */
  favoritesFor?: string
  seeds: string[]
  equipped: string[]
  exclude: string[]
  bodyShape?: string
  category?: string
  first: number
}): string {
  const parts = [
    input.address ?? 'anon',
    input.favoritesFor ?? 'unsigned',
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
