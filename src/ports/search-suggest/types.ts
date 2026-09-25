import { CreatorSearchHit } from '../creator-profiles/types'
import { CatalogItem } from '../items/types'

export type SuggestFilters = {
  search: string
  /** Rows per section. Each is clamped to 1..SUGGEST_SECTION_MAX_LIMIT. */
  items?: number
  collections?: number
  creators?: number
}

/** A catalogue item as the grid returns it, plus what to call its creator so the row needs no profile lookup. */
export type SuggestedItem = CatalogItem & { creatorName: string | null }

export type SuggestedCollection = {
  contractAddress: string
  name: string
  creator: string
  creatorName: string | null
  /** Approved items in it. */
  items: number
  /** Sales in the last COLLECTION_SALES_WINDOW_DAYS. What ties are broken on. */
  sales: number
}

export type SuggestResponse = {
  /**
   * What the grid the query lands on reports for it — the same universe and matching — so "See all (N)" is
   * that number. Not a promise of equality at the moment the grid opens: this answer may be cached for a
   * minute and the catalogue keeps moving underneath both.
   */
  items: { data: SuggestedItem[]; total: number }
  collections: { data: SuggestedCollection[] }
  creators: { data: CreatorSearchHit[] }
}

export interface ISearchSuggestComponent {
  suggest(filters: SuggestFilters): Promise<SuggestResponse>
}

export const SUGGEST_ITEMS_DEFAULT_LIMIT = 5
export const SUGGEST_CREATORS_DEFAULT_LIMIT = 4
export const SUGGEST_SECTION_MAX_LIMIT = 10
