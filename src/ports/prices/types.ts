import { NFTCategory, NFTFilters } from '@dcl/schemas'

export interface IPricesComponent {
  getPrices(filters: PriceFilters): Promise<GetPricesResponse>
}

export enum AssetType {
  NFT = 'nft',
  ITEM = 'item'
}

export enum PriceFilterExtraOption {
  LAND = 'land'
}

export type PriceFilterCategory = NFTCategory | PriceFilterExtraOption

export type PriceFilters = {
  category: PriceFilterCategory
  assetType?: AssetType
} & Pick<
  NFTFilters,
  | 'isWearableHead'
  | 'isWearableAccessory'
  | 'isWearableSmart'
  | 'wearableCategory'
  | 'wearableGenders'
  | 'emoteCategory'
  | 'emoteGenders'
  | 'emotePlayMode'
  | 'contractAddresses'
  | 'itemRarities'
  | 'network'
  | 'adjacentToRoad'
  | 'minDistanceToPlaza'
  | 'maxDistanceToPlaza'
  | 'minEstateSize'
  | 'maxEstateSize'
  | 'emoteHasGeometry'
  | 'emoteHasSound'
>

export type PriceFragment = {
  price: string
  id: string
}

export enum PriceSortBy {
  PRICE = 'price'
}

export type GetPricesResponse = Record<string, number>
