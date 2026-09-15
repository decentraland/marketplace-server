import type { SuggestionReason } from '../../logic/suggestions/scoring'
import { UnifiedItem } from '../shop-catalog/types'

export type { SuggestionReason, SuggestionReasonKind } from '../../logic/suggestions/scoring'

export type SuggestionsFilters = {
  /** Lowercased wallet. Absent for an anonymous caller, who can still personalise through `seeds`. */
  address?: string
  /**
   * Lowercased wallet the caller PROVED they control, from the optional auth-chain signature. Distinct
   * from `address`, which anyone can type: favourites are read for this one and never for that one.
   */
  verifiedAddress?: string
  /** `contract-itemId` the client has locally: recently viewed and cart. */
  seeds?: string[]
  /** Avatar body shape, e.g. `BaseFemale`. A hard compatibility filter when present. */
  bodyShape?: string
  /** What the avatar is wearing now, as `contract-itemId` or as a collections-v2 URN. */
  equipped?: string[]
  /** `contract-itemId` to keep out of the rail — the anchor item on a PDP. */
  exclude?: string[]
  category?: string
  first?: number
}

export type SuggestedItem = UnifiedItem & {
  reason: SuggestionReason
  score: number
}

export type SuggestionsResult = {
  data: SuggestedItem[]
  /** False when the rail is the trending fallback, so the Shop can hide it rather than show a generic rail. */
  personalized: boolean
  algorithm: string
}

export type ISuggestionsComponent = {
  getSuggestions(filters: SuggestionsFilters, manaUsdRate: number): Promise<SuggestionsResult>
}
