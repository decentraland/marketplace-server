import { Rarity, NFTCategory, Network } from '@dcl/schemas'

export type DBNFT = {
  id: string
  contract_address: string
  token_id: string
  network: Network
  created_at: number
  url: string
  updated_at: number
  sold_at: number
  urn: string
  owner: string
  image: string
  issued_id: string
  item_id: string
  rarity: Rarity
  category: NFTCategory
  name: string
}
