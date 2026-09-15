import { PROFILE_WEIGHTS, RECENCY_DECAY_DAYS } from './constants'

const SECONDS_PER_DAY = 86400

/** Where a profile entry came from, which is what the row's `reason` is derived from later. */
export type ProfileSource = 'owned' | 'favorite' | 'equipped' | 'seed'

export type ProfileEntry = {
  itemId: string
  weight: number
  source: ProfileSource
}

/** A purchase the wallet still holds. Unpaid acquisitions never reach the profile — see
 * FREE_ACQUISITION_WEIGHT — so there is no flag to carry. */
export type OwnedAcquisition = {
  itemId: string
  /** Unix seconds. */
  acquiredAt: number
}

export type ProfileInput = {
  owned: OwnedAcquisition[]
  favorites: string[]
  equipped: string[]
  seeds: string[]
  /** Unix seconds; injectable so the decay is testable. */
  now: number
  /** Most entries to keep. Omitted = no cap. */
  limit?: number
}

/** Signals the user expressed deliberately, as opposed to everything their wallet happens to hold. */
const EXPLICIT_SOURCES: ReadonlySet<ProfileSource> = new Set<ProfileSource>(['equipped', 'favorite', 'seed'])

/**
 * The wallet's taste profile: every signal we have about it, as one weighted set of item ids.
 *
 * `owned` carries only what the wallet BOUGHT and still holds; an item it was given never gets here.
 * Purchases decay with age. Favorites and equipped items outrank even a recent purchase: they are
 * statements about what the wallet likes NOW, not a year ago, so they carry no decay.
 *
 * When the same item arrives from several signals it keeps the strongest one rather than their sum,
 * so that an item the wallet owns, favourited and is wearing cannot crowd out everything else.
 */
export function buildTasteProfile(input: ProfileInput): ProfileEntry[] {
  const best = new Map<string, ProfileEntry>()

  const offer = (itemId: string, weight: number, source: ProfileSource): void => {
    if (!itemId || weight <= 0) return
    const current = best.get(itemId)
    if (!current || weight > current.weight) best.set(itemId, { itemId, weight, source })
  }

  for (const acquisition of input.owned) {
    const ageDays = Math.max(0, (input.now - acquisition.acquiredAt) / SECONDS_PER_DAY)
    offer(acquisition.itemId, PROFILE_WEIGHTS.paid * Math.exp(-ageDays / RECENCY_DECAY_DAYS), 'owned')
  }
  for (const itemId of input.favorites) offer(itemId, PROFILE_WEIGHTS.favorite, 'favorite')
  for (const itemId of input.equipped) offer(itemId, PROFILE_WEIGHTS.equipped, 'equipped')
  for (const itemId of input.seeds) offer(itemId, PROFILE_WEIGHTS.seed, 'seed')

  const byWeight = (a: ProfileEntry, b: ProfileEntry): number => b.weight - a.weight || (a.itemId < b.itemId ? -1 : 1)
  const entries = [...best.values()].sort(byWeight)
  if (input.limit === undefined || entries.length <= input.limit) return entries

  // The cap exists because a whale's holdings would overflow Postgres' bind-parameter limit, but
  // trimming by weight alone would spend the whole budget on purchases: a wallet with 900 recent paid
  // items has 900 entries at ~1.0, above the 0.8 a seed carries. Seeds, favourites and what the avatar
  // is wearing are the deliberate, current signals -- the ones most worth keeping -- so they are
  // reserved first and the remaining slots go to holdings by weight.
  const explicit = entries.filter(entry => EXPLICIT_SOURCES.has(entry.source))
  const owned = entries.filter(entry => !EXPLICIT_SOURCES.has(entry.source))
  const kept = explicit.slice(0, input.limit)
  return [...kept, ...owned.slice(0, input.limit - kept.length)].sort(byWeight)
}

export type ProfileAggregates = {
  creatorAffinity: Map<string, number>
  subCategoryAffinity: Map<string, number>
  rarityAffinity: Map<string, number>
  /** Interquartile range of the prices the wallet actually paid, in credits. */
  priceLow: number
  priceHigh: number
  /** Share of the profile that is wearables; drives the rail's wearable/emote mix. */
  wearableRatio: number
}

export type ProfileItemAttributes = {
  itemId: string
  creator: string
  subCategory: string
  rarity: string
  priceCredits: number
  isWearable: boolean
}

/** Shares of the profile's total weight per attribute — the inputs to the taste scorer. */
export function buildProfileAggregates(profile: ProfileEntry[], attributes: Map<string, ProfileItemAttributes>): ProfileAggregates {
  const creatorAffinity = new Map<string, number>()
  const subCategoryAffinity = new Map<string, number>()
  const rarityAffinity = new Map<string, number>()
  const prices: number[] = []
  let total = 0
  let wearableWeight = 0

  for (const entry of profile) {
    const item = attributes.get(entry.itemId)
    if (!item) continue
    total += entry.weight
    if (item.isWearable) wearableWeight += entry.weight
    if (item.creator) creatorAffinity.set(item.creator, (creatorAffinity.get(item.creator) ?? 0) + entry.weight)
    if (item.subCategory) subCategoryAffinity.set(item.subCategory, (subCategoryAffinity.get(item.subCategory) ?? 0) + entry.weight)
    if (item.rarity) rarityAffinity.set(item.rarity, (rarityAffinity.get(item.rarity) ?? 0) + entry.weight)
    if (item.priceCredits > 0) prices.push(item.priceCredits)
  }

  if (total > 0) {
    for (const [key, value] of creatorAffinity) creatorAffinity.set(key, value / total)
    for (const [key, value] of subCategoryAffinity) subCategoryAffinity.set(key, value / total)
    for (const [key, value] of rarityAffinity) rarityAffinity.set(key, value / total)
  }

  prices.sort((a, b) => a - b)
  const quantile = (q: number): number => (prices.length === 0 ? 0 : prices[Math.floor(q * (prices.length - 1))])

  return {
    creatorAffinity,
    subCategoryAffinity,
    rarityAffinity,
    priceLow: quantile(0.25),
    priceHigh: quantile(0.75),
    wearableRatio: total > 0 ? wearableWeight / total : 0
  }
}
