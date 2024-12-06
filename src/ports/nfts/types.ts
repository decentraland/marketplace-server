import {
  Rarity,
  NFTCategory,
  Network,
  NFTFilters,
  Order,
  RentalListing,
  NFT,
  BodyShape,
  WearableCategory,
  EmoteCategory
} from '@dcl/schemas'
import { SquidNetwork } from '../../types'
import { ItemType } from '../items'

export type INFTsComponent = {
  getNFTs(filters?: NFTFilters, caller?: string): Promise<GetNFTsResponse>
}

export type GetNFTsFilters = NFTFilters & { bannedNames?: string[] }

export type NFTResult = {
  nft: NFT
  order: Order | null
  rental: RentalListing | null
}

export type GetNFTsResponse = {
  data: NFTResult[]
  total: number
}

export type DBNFT = {
  id: string
  count: number
  contract_address: string
  token_id: string
  network: Network.MATIC | Network.ETHEREUM | SquidNetwork
  created_at: number
  url: string
  updated_at: number
  sold_at: number
  urn: string
  owner: string
  owner_id?: string
  image: string
  issued_id: string
  item_id: string
  item_type: ItemType
  rarity: Rarity
  category: NFTCategory
  name: string
  body_shapes: BodyShape[]
  x?: string
  y?: string
  wearable_category?: WearableCategory
  emote_category?: EmoteCategory
  description?: string
  isSmart?: boolean
  size?: number
  subdomain?: string
  loop?: boolean
  has_sound?: boolean
  has_geometry?: boolean
  estate_parcels?: { x: number; y: number }[]
  parcel_estate_token_id?: string
  parcel_estate_name?: string
  parcel_estate_id?: string
}
