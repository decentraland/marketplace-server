import { Rarity } from '@dcl/schemas'
import { DEFAULT_WEARABLE_RATIO, MAX_PER_COLLECTION, MAX_PER_CREATOR, SCORE_WEIGHTS } from './constants'
import type { ProfileAggregates } from './profile'

const RARITY_TIERS = Rarity.getRarities().map(rarity => rarity.toLowerCase())

export type SuggestionReasonKind = 'co_owned' | 'creator_affinity' | 'favorite_similar' | 'equipped_similar' | 'seed_similar' | 'trending'

export type SuggestionReason = {
  kind: SuggestionReasonKind
  itemId?: string
  creator?: string
}

/** One candidate with its raw, un-normalised component scores. */
export type ScoredCandidate = {
  itemId: string
  contractAddress: string
  collection: string
  creator: string
  subCategory: string
  rarity: string
  priceCredits: number
  isWearable: boolean
  cf: number
  content: number
  popularity: number
  /** The profile item that contributed most of `cf` + `content`, for the explanation. */
  topTriggerItemId?: string
  topTriggerSource?: 'owned' | 'favorite' | 'equipped' | 'seed'
}

/**
 * How well a candidate matches the wallet's aggregate taste, independent of any specific item it owns.
 * This is the component that produces "more from a creator you collect": it scores a brand-new drop
 * from a familiar creator that no co-ownership or content neighbour could reach.
 */
export function tasteScore(candidate: ScoredCandidate, aggregates: ProfileAggregates): number {
  const creator = candidate.creator ? aggregates.creatorAffinity.get(candidate.creator) ?? 0 : 0
  const subCategory = candidate.subCategory ? aggregates.subCategoryAffinity.get(candidate.subCategory) ?? 0 : 0

  let rarity = 0
  const tier = RARITY_TIERS.indexOf((candidate.rarity ?? '').toLowerCase())
  if (tier >= 0) {
    for (let t = Math.max(0, tier - 1); t <= Math.min(RARITY_TIERS.length - 1, tier + 1); t++) {
      rarity += aggregates.rarityAffinity.get(RARITY_TIERS[t]) ?? 0
    }
  }

  // Neutral rather than zero when the wallet has never paid for anything: an unknown price preference
  // should not push every priced candidate down.
  let price = 0.5
  if (aggregates.priceHigh > 0 && candidate.priceCredits > 0) {
    if (candidate.priceCredits >= aggregates.priceLow && candidate.priceCredits <= aggregates.priceHigh) price = 1
    else {
      const bound = candidate.priceCredits < aggregates.priceLow ? Math.max(aggregates.priceLow, 1e-9) : aggregates.priceHigh
      price = Math.exp(-Math.abs(Math.log(candidate.priceCredits / bound)))
    }
  }

  return 0.5 * creator + 0.3 * subCategory + 0.2 * (0.5 * rarity + 0.5 * price)
}

export type BlendedCandidate = ScoredCandidate & {
  taste: number
  score: number
  reason: SuggestionReason
}

/**
 * Blends the four components into one score.
 *
 * Each wallet-dependent component is divided by its own largest value across this wallet's candidates
 * first. Phase 0 fixed this: raw co-ownership sums run an order of magnitude above taste affinities,
 * which are shares of one, so without the rescaling the published weights describe a blend that never
 * happens. Popularity arrives already normalised to 0..1 across the catalogue and is left alone —
 * it is the one component that is deliberately NOT relative to the wallet.
 */
export function blendCandidates(
  candidates: ScoredCandidate[],
  aggregates: ProfileAggregates,
  profileCreatorCounts: Map<string, number> = new Map()
): BlendedCandidate[] {
  const tastes = candidates.map(candidate => tasteScore(candidate, aggregates))

  let maxCf = 0
  let maxContent = 0
  let maxTaste = 0
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].cf > maxCf) maxCf = candidates[i].cf
    if (candidates[i].content > maxContent) maxContent = candidates[i].content
    if (tastes[i] > maxTaste) maxTaste = tastes[i]
  }

  return candidates.map((candidate, i) => {
    const cf = maxCf > 0 ? candidate.cf / maxCf : 0
    const content = maxContent > 0 ? candidate.content / maxContent : 0
    const taste = maxTaste > 0 ? tastes[i] / maxTaste : 0
    const contributions = {
      cf: SCORE_WEIGHTS.cf * cf,
      content: SCORE_WEIGHTS.content * content,
      taste: SCORE_WEIGHTS.taste * taste,
      popularity: SCORE_WEIGHTS.popularity * candidate.popularity
    }
    return {
      ...candidate,
      taste: tastes[i],
      score: contributions.cf + contributions.content + contributions.taste + contributions.popularity,
      reason: pickReason(candidate, contributions, collectsCreator(candidate.creator, profileCreatorCounts))
    }
  })
}

/**
 * The single signal that contributed most of the row's score, mapped to the copy the Shop shows.
 *
 * Taste winning means the wallet's affinity for the creator carried the row, which is exactly
 * "more from a creator you collect". Popularity winning means nothing personal did.
 */
export function pickReason(
  candidate: ScoredCandidate,
  contributions: { cf: number; content: number; taste: number; popularity: number },
  collectsCreator = false
): SuggestionReason {
  const ranked = (Object.entries(contributions) as Array<[keyof typeof contributions, number]>).sort((a, b) => b[1] - a[1])
  const [winner, value] = ranked[0]

  if (value <= 0) return { kind: 'trending' }

  // Taste is three things at once -- creator, sub-category, rarity/price -- so winning on taste is not
  // by itself evidence that the wallet collects this creator. Claiming "more from a creator you
  // collect" about a creator the wallet has never bought from is the one explanation here that would
  // read as an outright lie, so it has to be earned separately.
  if (winner === 'taste') {
    if (collectsCreator && candidate.creator) return { kind: 'creator_affinity', creator: candidate.creator }
    return reasonFromTrigger(candidate)
  }
  if (winner === 'popularity') return { kind: 'trending' }

  return reasonFromTrigger(candidate)
}

/** cf and content are both driven by a specific profile item, so the explanation names it -- and names
 * it for what it was: something worn, favourited, browsed, or owned. */
function reasonFromTrigger(candidate: ScoredCandidate): SuggestionReason {
  const trigger = candidate.topTriggerItemId
  if (!trigger) return { kind: 'trending' }
  switch (candidate.topTriggerSource) {
    case 'favorite':
      return { kind: 'favorite_similar', itemId: trigger }
    case 'equipped':
      return { kind: 'equipped_similar', itemId: trigger }
    // A seed is something the visitor looked at or put in the cart, never something they hold, so
    // "because you have X" would be wrong about an item they do not own.
    case 'seed':
      return { kind: 'seed_similar', itemId: trigger }
    default:
      return { kind: 'co_owned', itemId: trigger }
  }
}

/** Whether the profile holds enough of this creator for "a creator you collect" to be true. */
export function collectsCreator(creator: string, profileCreatorCounts: Map<string, number>): boolean {
  return creator !== '' && (profileCreatorCounts.get(creator) ?? 0) >= MIN_ITEMS_TO_COLLECT_CREATOR
}

/** One item by a creator is a purchase; two is a pattern worth naming. */
const MIN_ITEMS_TO_COLLECT_CREATOR = 2

/**
 * Re-ranks the scored head into the rail the user sees.
 *
 * A pure score ordering collapses: co-ownership is strongest inside a collection, so the top 12 is
 * routinely eight items from one drop. The caps spend the rail on variety instead, and the
 * wearable/emote mix follows what the wallet actually collects so an emote collector does not get a
 * wall of hats.
 *
 * The constraints are relaxed in tiers rather than all at once, because they are not equally
 * important. Never showing the same sub-category twice in a row is a presentation nicety; showing
 * eight items from one collection defeats the point of the rail. So a rail short on supply first
 * gives up the run-breaking, then the caps, and only ever falls back to pure score order. A short
 * rail is the worst outcome of the three, so the last tier accepts anything.
 */
export function rerankForDiversity<T extends BlendedCandidate>(candidates: T[], limit: number, wearableRatio: number): T[] {
  const ordered = [...candidates].sort((a, b) => b.score - a.score || (a.itemId < b.itemId ? -1 : 1))
  const ratio = Number.isFinite(wearableRatio) && wearableRatio > 0 ? wearableRatio : DEFAULT_WEARABLE_RATIO
  const wearableTarget = Math.round(limit * ratio)

  const picked: T[] = []
  const taken = new Set<string>()
  const perCollection = new Map<string, number>()
  const perCreator = new Map<string, number>()
  let wearables = 0
  let emotes = 0
  let lastSubCategory: string | undefined

  const accept = (candidate: T): void => {
    picked.push(candidate)
    taken.add(candidate.itemId)
    perCollection.set(candidate.collection, (perCollection.get(candidate.collection) ?? 0) + 1)
    perCreator.set(candidate.creator, (perCreator.get(candidate.creator) ?? 0) + 1)
    if (candidate.isWearable) wearables += 1
    else emotes += 1
    lastSubCategory = candidate.subCategory || undefined
  }

  for (const tier of ['all', 'without-run-breaking', 'score-only'] as const) {
    for (const candidate of ordered) {
      if (picked.length >= limit) return picked
      if (taken.has(candidate.itemId)) continue
      if (tier === 'score-only') {
        accept(candidate)
        continue
      }

      const collectionCount = perCollection.get(candidate.collection) ?? 0
      const creatorCount = perCreator.get(candidate.creator) ?? 0
      const wouldExceedMix = candidate.isWearable
        ? wearables >= wearableTarget && emotes < limit - wearableTarget
        : emotes >= limit - wearableTarget && wearables < wearableTarget

      if (candidate.collection && collectionCount >= MAX_PER_COLLECTION) continue
      if (candidate.creator && creatorCount >= MAX_PER_CREATOR) continue
      if (wouldExceedMix) continue
      if (tier === 'all' && lastSubCategory !== undefined && candidate.subCategory !== '' && candidate.subCategory === lastSubCategory) {
        continue
      }

      accept(candidate)
    }
  }

  return picked
}
