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
  /** Approved collections those items sit in. */
  collections: number
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
 * Profile names and avatars change rarely, so this is about how stale a renamed creator may be in the
 * search: up to six hours here, plus up to five minutes for the words rebuild, plus the run itself
 * (sixteen Catalyst calls and one upsert). A successful run triggers the rebuild at once, so the first
 * fill after a deploy — a minute after boot — is searchable a minute or two later, not five more.
 *
 * A run that fails outright (the database, not one Catalyst batch, which has its own retries) is tried
 * again after these waits rather than left for the next interval.
 */
export const CREATOR_PROFILES_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000
export const CREATOR_PROFILES_REFRESH_STARTUP_DELAY_MS = 60 * 1000
export const CREATOR_PROFILES_RUN_RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000]
