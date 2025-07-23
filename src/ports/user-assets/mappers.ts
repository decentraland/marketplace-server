import { EmoteCategory, Rarity, WearableCategory } from '@dcl/schemas'
import { ProfileWearable, ProfileEmote, ProfileName, DappsDbRow } from './types'

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
