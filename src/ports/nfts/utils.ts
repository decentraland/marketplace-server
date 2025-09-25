import fetch from 'node-fetch'
import { NFTCategory, NFTFilters, RentalListing, RentalStatus } from '@dcl/schemas'
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

export async function getNFTFilters(
  filters: NFTFilters,
  listsServer: string,
  rentals: IRentalsComponent
): Promise<{ filters: GetNFTsFilters; listings?: RentalListing[] }> {
  let bannedNames: string[] = []

  if (filters.category === NFTCategory.ENS) {
    bannedNames = await getBannedNames(listsServer)
  }

  const shouldFetchRentalListings =
    (filters.category === NFTCategory.ESTATE || filters.category === NFTCategory.PARCEL || filters.isLand) && filters.isOnRent

  let listings: RentalListing[] | undefined = undefined

  // TODO: check filter by owner
  if (shouldFetchRentalListings) {
    const rentalsResponse = await rentals.getRentalsListings({ ...filters, first: 1000, skip: 0, rentalStatus: RentalStatus.OPEN }) // TODO: workdaround for the time being since we need all ids with rentals
    filters.ids = rentalsResponse.data.results.map(rentalListing => rentalListing.nftId)
    listings = rentalsResponse.data.results
  }

  return { filters: { ...filters, bannedNames }, listings }
}

export function fixUrn(urn: string) {
  return urn.replace('mainnet', 'ethereum')
}
