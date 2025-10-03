import { EmoteCategory, Rarity, WearableCategory } from '@dcl/schemas'
import { ProfileWearable, ProfileEmote, ProfileName, DappsDbRow, GroupedWearable, GroupedEmote } from './types'

export function fromDbRowsToWearables(rows: DappsDbRow[]): ProfileWearable[] {
  return rows.map(row => {
    return {
      urn: row.urn,
      id: row.id,
      tokenId: row.token_id,
      category: (row.category as WearableCategory) || WearableCategory.EYEWEAR,
      transferredAt: String(row.transferred_at) || null,
      name: row.name || '',
      rarity: row.rarity || Rarity.COMMON,
      price: row.price
    }
  })
}

export function fromDbRowsToEmotes(rows: DappsDbRow[]): ProfileEmote[] {
  return rows.map(row => {
    return {
      urn: row.urn,
      id: row.id,
      tokenId: row.token_id,
      category: (row.category as EmoteCategory) || EmoteCategory.DANCE,
      transferredAt: String(row.transferred_at) || null,
      name: row.name || '',
      rarity: row.rarity || Rarity.COMMON,
      price: row.price
    }
  })
}

export function fromDbRowsToNames(rows: DappsDbRow[]): ProfileName[] {
  return rows.map(row => ({
    name: row.name || '',
    contractAddress: row.contract_address,
    tokenId: row.token_id,
    price: row.price
  }))
}

// Type for grouped database results
type GroupedDbRow = {
  urn: string
  category: string
  rarity: string
  name: string
  amount: number
  min_transferred_at: number
  max_transferred_at: number
  individual_data: Array<{
    id: string
    tokenId: string
    transferredAt: string // Now string because of ::text cast in SQL
    price: string // Now string because of ::text cast in SQL
  }>
}

export function fromDbRowsToGroupedWearables(rows: GroupedDbRow[]): GroupedWearable[] {
  return rows.map(row => {
    return {
      urn: row.urn,
      amount: row.amount,
      individualData: row.individual_data, // SQL already casts to text, so these are strings
      name: row.name || '',
      rarity: row.rarity || Rarity.COMMON,
      minTransferredAt: row.min_transferred_at || 0,
      maxTransferredAt: row.max_transferred_at || 0,
      category: (row.category as WearableCategory) || WearableCategory.EYEWEAR
    }
  })
}

export function fromDbRowsToGroupedEmotes(rows: GroupedDbRow[]): GroupedEmote[] {
  return rows.map(row => {
    return {
      urn: row.urn,
      amount: row.amount,
      individualData: row.individual_data,
      name: row.name || '',
      rarity: row.rarity || Rarity.COMMON,
      minTransferredAt: row.min_transferred_at || 0,
      maxTransferredAt: row.max_transferred_at || 0,
      category: (row.category as EmoteCategory) || EmoteCategory.DANCE
    }
  })
}
