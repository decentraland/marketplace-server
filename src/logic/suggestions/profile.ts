import { PROFILE_WEIGHTS, RECENCY_DECAY_DAYS } from './constants'

const SECONDS_PER_DAY = 86400

/** Where a profile entry came from, which is what the row's `reason` is derived from later. */
export type ProfileSource = 'owned' | 'favorite' | 'equipped' | 'seed'

export type ProfileEntry = {
  itemId: string
  weight: number
  source: ProfileSource
}

export type OwnedAcquisition = {
  itemId: string
  paid: boolean
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
}

/**
 * The wallet's taste profile: every signal we have about it, as one weighted set of item ids.
 *
 * Paid acquisitions outweigh free ones by more than three to one because 69% of recent mints are
 * airdrops and claims — an item someone was given says much less about their taste than one they chose
 * to buy. Both decay with age. Favorites and equipped items outrank even a purchase: they are
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
    const base = acquisition.paid ? PROFILE_WEIGHTS.paid : PROFILE_WEIGHTS.free
    offer(acquisition.itemId, base * Math.exp(-ageDays / RECENCY_DECAY_DAYS), 'owned')
  }
  for (const itemId of input.favorites) offer(itemId, PROFILE_WEIGHTS.favorite, 'favorite')
  for (const itemId of input.equipped) offer(itemId, PROFILE_WEIGHTS.equipped, 'equipped')
  for (const itemId of input.seeds) offer(itemId, PROFILE_WEIGHTS.seed, 'seed')

  return [...best.values()].sort((a, b) => b.weight - a.weight || (a.itemId < b.itemId ? -1 : 1))
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
