import { EmoteCategory, Rarity, WearableCategory } from '@dcl/schemas'

export type DBItem = {
  id: string
  image: string
  uri: string
  category: WearableCategory | EmoteCategory
  item_id: string
  contract_address: string
  rarity: Rarity
  price: string
  available: number
  creator: string
  beneficiary: string
  created_at: number
  updated_at: number
  reviewed_at: number
  sold_at: number
  urn: string
  name: string
}
