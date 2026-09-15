/**
 * `urn:decentraland:<chain>:collections-v2:<contract>:<itemId>` -> the `contract-itemId` the rest of
 * the pipeline keys on. Both the Polygon mainnet (`matic`) and testnet (`amoy`) chains are accepted so
 * a dev profile resolves the same way a production one does.
 *
 * Base avatars (`urn:decentraland:off-chain:base-avatars:…`) return null on purpose: they are given to
 * every account, so they say nothing about taste and they are not items anyone can buy.
 */
const COLLECTIONS_V2_URN = /^urn:decentraland:(matic|amoy):collections-v2:(0x[0-9a-fA-F]{40}):(\d+)$/

export function urnToItemId(urn: string): string | null {
  const match = COLLECTIONS_V2_URN.exec(urn.trim())
  if (!match) return null
  return `${match[2].toLowerCase()}-${match[3]}`
}

export function urnsToItemIds(urns: string[]): string[] {
  const ids = new Set<string>()
  for (const urn of urns) {
    const id = urnToItemId(urn)
    if (id) ids.add(id)
  }
  return [...ids]
}

/**
 * Either spelling of the same thing, because the equipped list is the one place the client has URNs
 * rather than ids.
 *
 * A URN is 83 characters against the id's 45, and thirty of them is most of the query string; the Shop
 * therefore converts before sending. Accepting both is what lets that change ship without the two
 * deploys having to land in order -- an older Shop keeps working against a newer server.
 */
export function toItemIds(values: string[], limit: number): string[] {
  const ids = new Set<string>()
  for (const value of values) {
    const id = value.includes(':') ? urnToItemId(value) : normalizeItemId(value)
    if (id) ids.add(id)
    if (ids.size >= limit) break
  }
  return [...ids]
}

/** `<contract>-<itemId>` as sent by the client, validated rather than trusted: it reaches SQL. */
const ITEM_ID = /^(0x[0-9a-fA-F]{40})-(\d+)$/

export function normalizeItemId(value: string): string | null {
  const match = ITEM_ID.exec(value.trim())
  if (!match) return null
  return `${match[1].toLowerCase()}-${match[2]}`
}

export function normalizeItemIds(values: string[], limit: number): string[] {
  const ids = new Set<string>()
  for (const value of values) {
    const id = normalizeItemId(value)
    if (id) ids.add(id)
    if (ids.size >= limit) break
  }
  return [...ids]
}
