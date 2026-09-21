import { CreatorProfilesRefreshResult } from '../../logic/catalog/creator-profiles'

export type CreatorSearchFilters = {
  search: string
  first?: number
}

/** A creator the search dropdown can offer: who to link to, what to call them, what they look like. */
export type CreatorSearchHit = {
  address: string
  name: string
  face: string | null
  /** Approved items they have published. What the ranking breaks ties on. */
  items: number
}

export interface ICreatorProfilesComponent {
  /** Brings the creator profiles table up to date. Run by a job, never by a request. */
  refresh(): Promise<CreatorProfilesRefreshResult>
  search(filters: CreatorSearchFilters): Promise<{ data: CreatorSearchHit[] }>
}

/** Where profile names and avatars come from when PEER_URL is not set. */
export const DEFAULT_PEER_URL = 'https://peer.decentraland.org'

/** Hard cap on one Catalyst batch. The job is not on any request path; this only keeps a hung call from stalling the run. */
export const CREATOR_PROFILES_LOOKUP_TIMEOUT_MS = 10_000

/**
 * Profile names and avatars change rarely, and the table is what the words rebuild reads every five
 * minutes, so this is about how stale a renamed creator may be in the search — hours is fine. The first
 * run happens shortly after boot, so a fresh deploy is not nameless until the first interval elapses.
 */
export const CREATOR_PROFILES_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000
export const CREATOR_PROFILES_REFRESH_STARTUP_DELAY_MS = 60 * 1000
