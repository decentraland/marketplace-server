import fetch from 'node-fetch'
import { NFTCategory, NFTFilters } from '@dcl/schemas'
import { IRentalsComponent } from '../rentals/types'
import { GetNFTsFilters } from './types'

export async function getBannedNames(listsServer: string): Promise<string[]> {
  try {
    const bannedNames = await fetch(`${listsServer}/banned-names`, {
      method: 'POST'
    })

    const data: { data: string[] } = await bannedNames.json()
    return data.data
  } catch (error) {
    console.error('Error fetching banned names: ', error)
    // if there was an error fetching the lists server, return an empty array
    return []
  }
}

export async function getNFTFilters(filters: NFTFilters, listsServer: string, rentals: IRentalsComponent): Promise<GetNFTsFilters> {
  let bannedNames: string[] = []

  if (filters.category === NFTCategory.ENS) {
    bannedNames = await getBannedNames(listsServer)
  }

  const shouldFetchRentalListings =
    (filters.category === NFTCategory.ESTATE || filters.category === NFTCategory.PARCEL || filters.isLand) && filters.isOnRent

  // TODO: check filter by owner
  if (shouldFetchRentalListings) {
    const listings = await rentals.getRentalsListings({ ...filters, first: 1000 }) // TODO: workdaround for the time being since we need all ids with rentals
    filters.ids = listings.data.results.map(rentalListing => rentalListing.nftId)
  }

  return { ...filters, bannedNames }
}
