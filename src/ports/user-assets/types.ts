import { WearableCategory, EmoteCategory } from '@dcl/schemas'

export interface IUserAssetsComponent {
  /**
   * Gets complete wearable data for a user
   * Returns full wearable information including metadata, rarity, pricing, etc.
   */
  getWearablesByOwner(owner: string, first?: number, skip?: number): Promise<{ data: ProfileWearable[]; total: number }>

  /**
   * Gets minimal wearable data for profile validation - used by profiles endpoint
   * Returns only URN and token ID for efficient wearable ownership validation
   */
  getOwnedWearablesUrnAndTokenId(
    owner: string,
    first?: number,
    skip?: number
  ): Promise<{ data: { urn: string; tokenId: string }[]; total: number }>

  /**
   * Gets complete emote data for a user
   * Returns full emote information including metadata, rarity, pricing, etc.
   */
  getEmotesByOwner(owner: string, first?: number, skip?: number): Promise<{ data: ProfileEmote[]; total: number }>

  /**
   * Gets minimal emote data for profile validation - used by profiles endpoint
   * Returns only URN and token ID for efficient emote ownership validation
   */
  getOwnedEmotesUrnAndTokenId(
    owner: string,
    first?: number,
    skip?: number
  ): Promise<{ data: { urn: string; tokenId: string }[]; total: number }>

  /**
   * Gets complete name/ENS data for a user
   * Returns full name information including contract details and pricing
   */
  getNamesByOwner(owner: string, first?: number, skip?: number): Promise<{ data: ProfileName[]; total: number }>

  /**
   * Gets minimal name data for profile validation
   * Returns only the name/subdomain for efficient name ownership validation
   */
  getOwnedNamesOnly(owner: string, first?: number, skip?: number): Promise<{ data: { name: string }[]; total: number }>
}

export type ProfileWearable = {
  urn: string
  id: string
  tokenId: string
  category: WearableCategory
  transferredAt: string | null
  name: string
  rarity: string
  price?: number
}

export type ProfileEmote = {
  urn: string
  id: string
  tokenId: string
  category: EmoteCategory
  transferredAt: string | null
  name: string
  rarity: string
  price?: number
}

export type ProfileName = {
  name: string
  contractAddress: string
  tokenId: string
  price?: number
}

export type DappsDbRow = {
  id: string
  contract_address: string
  token_id: string
  network: string
  created_at: string
  updated_at: string
  sold_at?: string
  urn: string
  owner: string
  image?: string
  issued_id?: string
  item_id?: string
  category: string
  rarity?: string
  name?: string
  item_type?: string
  transferred_at?: number
  price?: number
}

// API Response types
export type UserWearablesResponse = {
  elements: ProfileWearable[]
  page: number
  pages: number
  limit: number
  total: number
}

export type UserEmotesResponse = {
  elements: ProfileEmote[]
  page: number
  pages: number
  limit: number
  total: number
}

export type UserNamesResponse = {
  elements: ProfileName[]
  page: number
  pages: number
  limit: number
  total: number
}

export type UserWearablesUrnTokenResponse = {
  elements: { urn: string; tokenId: string }[]
  page: number
  pages: number
  limit: number
  total: number
}

export type UserEmotesUrnTokenResponse = {
  elements: { urn: string; tokenId: string }[]
  page: number
  pages: number
  limit: number
  total: number
}

export type UserNamesOnlyResponse = {
  elements: { name: string }[]
  page: number
  pages: number
  limit: number
  total: number
}
