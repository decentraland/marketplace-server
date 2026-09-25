import { TopOwner, TopOwnerDBRow, TopOwnersSortBy } from './types'

export const TOP_OWNERS_DEFAULT_LIMIT = 20
export const TOP_OWNERS_MAX_LIMIT = 100

/**
 * Maps an aggregated row to the API shape.
 *
 * @param row - One owner as the top-owners query returns it.
 * @returns The owner, with the acquisition time in milliseconds.
 */
export function fromTopOwnerDBRow(row: TopOwnerDBRow): TopOwner {
  return {
    address: row.owner,
    nfts: Number(row.nfts),
    items: Number(row.items),
    collections: Number(row.collections),
    lastAcquiredAt: Number(row.last_at) * 1000,
    spentWei: row.spent
  }
}

function valueOf(owner: TopOwner, sortBy: TopOwnersSortBy): number | bigint {
  switch (sortBy) {
    case TopOwnersSortBy.ITEMS:
      return owner.items
    case TopOwnersSortBy.COLLECTIONS:
      return owner.collections
    case TopOwnersSortBy.RECENT:
      return owner.lastAcquiredAt
    case TopOwnersSortBy.SPENT:
      return BigInt(owner.spentWei)
    case TopOwnersSortBy.NFTS:
      return owner.nfts
    default: {
      const unhandled: never = sortBy
      return unhandled
    }
  }
}

/**
 * Sorts and pages the owners of a creator.
 *
 * Ties fall back to NFTs held, then to the most recent acquisition, then to the address, so every page is
 * stable across requests and no owner can appear on two pages or on none.
 *
 * @param owners - Every owner of the creator.
 * @param options - Sort key, direction, and page.
 * @returns The requested page and the total number of owners.
 */
export function rankTopOwners(
  owners: TopOwner[],
  options: { sortBy?: TopOwnersSortBy; orderDirection?: 'asc' | 'desc'; first?: number; skip?: number }
): { data: TopOwner[]; total: number } {
  const sortBy = options.sortBy ?? TopOwnersSortBy.NFTS
  const sign = options.orderDirection === 'asc' ? 1 : -1
  const compare = (a: number | bigint, b: number | bigint) => (a === b ? 0 : a < b ? -1 : 1)
  const sorted = [...owners].sort(
    (a, b) =>
      sign * compare(valueOf(a, sortBy), valueOf(b, sortBy)) ||
      compare(b.nfts, a.nfts) ||
      compare(b.lastAcquiredAt, a.lastAcquiredAt) ||
      a.address.localeCompare(b.address)
  )
  const first = Math.min(Math.max(1, Math.floor(options.first ?? TOP_OWNERS_DEFAULT_LIMIT)), TOP_OWNERS_MAX_LIMIT)
  const skip = Math.max(0, Math.floor(options.skip ?? 0))
  return { data: sorted.slice(skip, skip + first), total: sorted.length }
}
