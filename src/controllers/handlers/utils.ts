import { ethers } from 'ethers'
import {
  EmoteCategory,
  EmotePlayMode,
  GenderFilterOption,
  NFTCategory,
  NFTFilters,
  OrderFilters,
  NFTSortBy,
  Network,
  Rarity,
  RentalStatus,
  WearableCategory,
  OrderSortBy,
  ListingStatus,
  SaleFilters,
  SaleSortBy,
  SaleType
} from '@dcl/schemas'
import { Params } from '../../logic/http/params'
import { AssetType, PriceFilterCategory, PriceFilters } from '../../ports/prices'

export const getItemsParams = (params: Params) => {
  const maxPrice = params.getString('maxPrice')
  const minPrice = params.getString('minPrice')
  return {
    category: params.getValue<NFTCategory>('category', NFTCategory),
    creator: params.getList('creator'),
    isSoldOut: params.getBoolean('isSoldOut'),
    isOnSale: params.getBoolean('isOnSale') ? params.getString('isOnSale') === 'true' : undefined,
    search: params.getString('search'),
    isWearableHead: params.getBoolean('isWearableHead'),
    isWearableAccessory: params.getBoolean('isWearableAccessory'),
    isWearableSmart: params.getBoolean('isWearableSmart'),
    wearableCategory: params.getValue<WearableCategory>('wearableCategory', WearableCategory),
    rarities: params.getList<Rarity>('rarity', Rarity),
    wearableGenders: params.getList<GenderFilterOption>('wearableGender', GenderFilterOption),
    emoteCategory: params.getValue<EmoteCategory>('emoteCategory', EmoteCategory),
    emoteGenders: params.getList<GenderFilterOption>('emoteGender', GenderFilterOption),
    emotePlayMode: params.getList<EmotePlayMode>('emotePlayMode', EmotePlayMode),
    emoteHasGeometry: params.getBoolean('emoteHasGeometry'),
    emoteHasSound: params.getBoolean('emoteHasSound'),
    contractAddresses: params.getList('contractAddress'),
    itemId: params.getString('itemId'),
    network: params.getValue<Network>('network', Network),
    maxPrice: maxPrice ? ethers.parseEther(maxPrice).toString() : undefined,
    minPrice: minPrice ? ethers.parseEther(minPrice).toString() : undefined,
    urns: params.getList('urn'),
    ids: params.getList('id')
  }
}

export const getNFTParams = (params: Params): NFTFilters => {
  const maxPrice = params.getString('maxPrice')
  const minPrice = params.getString('minPrice')
  return {
    first: params.getNumber('first'),
    skip: params.getNumber('skip'),
    sortBy: params.getValue<NFTSortBy>('sortBy', NFTSortBy),
    category: params.getValue<NFTCategory>('category', NFTCategory),
    owner: params.getAddress('owner') || undefined,
    isOnSale: params.getBoolean('isOnSale'),
    isOnRent: params.getBoolean('isOnRent'),
    search: params.getString('search'),
    isLand: params.getBoolean('isLand'),
    isWearableHead: params.getBoolean('isWearableHead'),
    isWearableAccessory: params.getBoolean('isWearableAccessory'),
    isWearableSmart: params.getBoolean('isWearableSmart'),
    wearableCategory: params.getValue<WearableCategory>('wearableCategory', WearableCategory),
    wearableGenders: params.getList<GenderFilterOption>('wearableGender', GenderFilterOption),
    emoteCategory: params.getValue<EmoteCategory>('emoteCategory', EmoteCategory),
    emoteGenders: params.getList<GenderFilterOption>('emoteGender', GenderFilterOption),
    emotePlayMode: params.getList<EmotePlayMode>('emotePlayMode', EmotePlayMode),
    contractAddresses: params.getAddressList('contractAddress'),
    creator: params.getList('creator'),
    tokenId: params.getString('tokenId'),
    itemRarities: params.getList<Rarity>('itemRarity', Rarity),
    itemId: params.getString('itemId'),
    network: params.getValue<Network>('network', Network),
    rentalStatus: params.getList<RentalStatus>('rentalStatus', RentalStatus),
    adjacentToRoad: params.getBoolean('adjacentToRoad'),
    minDistanceToPlaza: params.getNumber('minDistanceToPlaza'),
    maxDistanceToPlaza: params.getNumber('maxDistanceToPlaza'),
    tenant: params.getAddress('tenant')?.toLowerCase(),
    maxPrice: maxPrice ? ethers.parseEther(maxPrice).toString() : undefined,
    minPrice: minPrice ? ethers.parseEther(minPrice).toString() : undefined,
    minEstateSize: params.getNumber('minEstateSize'),
    maxEstateSize: params.getNumber('maxEstateSize'),
    emoteHasGeometry: params.getBoolean('emoteHasGeometry'),
    emoteHasSound: params.getBoolean('emoteHasSound'),
    rentalDays: params
      .getList('rentalDays')
      .map(days => Number.parseInt(days))
      .filter(number => !Number.isNaN(number))
  }
}

export const getOrdersParams = (params: Params): OrderFilters => {
  return {
    first: params.getNumber('first'),
    skip: params.getNumber('skip'),
    sortBy: params.getValue<OrderSortBy>('sortBy', OrderSortBy),
    marketplaceAddress: params.getValue('marketplaceAddress'),
    owner: params.getValue('owner'),
    buyer: params.getValue('buyer'),
    contractAddress: params.getValue('contractAddress'),
    tokenId: params.getValue('tokenId'),
    status: params.getValue<ListingStatus>('status', ListingStatus),
    network: params.getValue<Network>('network', Network),
    itemId: params.getValue('itemId'),
    nftName: params.getValue('nftName')
  }
}

export const getSalesParams = (params: Params): SaleFilters => {
  return {
    first: params.getNumber('first'),
    skip: params.getNumber('skip'),
    sortBy: params.getValue<SaleSortBy>('sortBy', SaleSortBy),
    type: params.getValue<SaleType>('type', SaleType),
    categories: params.getList<NFTCategory>('category', NFTCategory),
    seller: params.getAddress('seller') || undefined,
    buyer: params.getAddress('buyer') || undefined,
    contractAddress: params.getAddress('contractAddress') || undefined,
    tokenId: params.getString('tokenId'),
    itemId: params.getString('itemId'),
    from: params.getNumber('from'),
    to: params.getNumber('to'),
    minPrice: params.getString('minPrice'),
    maxPrice: params.getString('maxPrice'),
    network: params.getValue<Network>('network', Network)
  }
}

export const getPricesParams = (params: Params): PriceFilters => {
  return {
    category: params.getString('category') as PriceFilterCategory,
    assetType: params.getString('assetType') as AssetType,
    isWearableHead: params.getBoolean('isWearableHead'),
    isWearableAccessory: params.getBoolean('isWearableAccessory'),
    isWearableSmart: params.getBoolean('isWearableSmart'),
    wearableCategory: params.getValue<WearableCategory>('wearableCategory', WearableCategory),
    wearableGenders: params.getList<GenderFilterOption>('wearableGender', GenderFilterOption),
    emoteCategory: params.getValue<EmoteCategory>('emoteCategory', EmoteCategory),
    emoteGenders: params.getList<GenderFilterOption>('emoteGender', GenderFilterOption),
    emotePlayMode: params.getList<EmotePlayMode>('emotePlayMode', EmotePlayMode),
    contractAddresses: params.getAddressList('contractAddress'),
    itemRarities: params.getList<Rarity>('itemRarity', Rarity),
    network: params.getValue<Network>('network', Network),
    adjacentToRoad: params.getBoolean('adjacentToRoad'),
    minDistanceToPlaza: params.getNumber('minDistanceToPlaza'),
    maxDistanceToPlaza: params.getNumber('maxDistanceToPlaza'),
    maxEstateSize: params.getNumber('maxEstateSize'),
    minEstateSize: params.getNumber('minEstateSize'),
    emoteHasSound: params.getBoolean('emoteHasSound'),
    emoteHasGeometry: params.getBoolean('emoteHasGeometry')
  }
}
