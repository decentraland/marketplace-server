import { BN } from 'bn.js'
import { CatalogFilters, NFTCategory, NFTFilters } from '@dcl/schemas'
import { PriceFilterCategory, PriceFilterExtraOption, PriceFilters } from './types'

export const getNFTCategoryFromPriceCategory = (category: PriceFilterCategory) => {
  switch (category) {
    case PriceFilterExtraOption.LAND:
      return [NFTCategory.PARCEL, NFTCategory.ESTATE]
    default:
      return [category]
  }
}

export const isFetchingLand = (filters: PriceFilters) => {
  return (
    filters.adjacentToRoad ||
    filters.minDistanceToPlaza ||
    filters.maxDistanceToPlaza ||
    filters.minEstateSize ||
    filters.maxEstateSize ||
    filters.category === PriceFilterExtraOption.LAND ||
    filters.category === NFTCategory.PARCEL ||
    filters.category === NFTCategory.ESTATE
  )
}

export const fromPriceFiltersToNFTFilters = (filters: PriceFilters): NFTFilters => {
  return {
    adjacentToRoad: filters.adjacentToRoad,
    minDistanceToPlaza: filters.minDistanceToPlaza,
    maxDistanceToPlaza: filters.maxDistanceToPlaza,
    minEstateSize: filters.minEstateSize,
    maxEstateSize: filters.maxEstateSize,
    category: getNFTCategoryFromPriceCategory(filters.category)[0]
  }
}

export const fromPriceFiltersToCatalogFilters = (filters: PriceFilters): CatalogFilters => {
  return {
    isWearableHead: filters.isWearableHead,
    isWearableAccessory: filters.isWearableAccessory,
    isWearableSmart: filters.isWearableSmart,
    wearableCategory: filters.wearableCategory,
    wearableGenders: filters.wearableGenders,
    emoteCategory: filters.emoteCategory,
    emoteGenders: filters.emoteGenders,
    emotePlayMode: filters.emotePlayMode,
    contractAddresses: filters.contractAddresses,
    rarities: filters.itemRarities,
    network: filters.network,
    emoteHasGeometry: filters.emoteHasGeometry,
    emoteHasSound: filters.emoteHasSound,
    category: getNFTCategoryFromPriceCategory(filters.category)[0]
  }
}

export function consolidatePrices(prices: { price: string }[]) {
  // prices is an object of the price and the amount of items with that price, the following reduce adds 1 for each price occurence
  const unordered = prices.reduce((acc, { price }) => {
    acc[price] = acc[price] ? acc[price] + 1 : 1
    return acc
  }, {} as Record<string, number>)
  // we order the prices since the merger will return them un-ordered because it doesn't know how to compare BNs
  const ordered = Object.keys(unordered)
    .sort((a, b) => (new BN(a).gt(new BN(b)) ? 1 : -1))
    .reduce((obj, key) => {
      obj[key] = unordered[key]
      return obj
    }, {} as Record<string, number>)
  return ordered
}
