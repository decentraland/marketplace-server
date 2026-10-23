/**
 * Holdings on Ethereum as they were at a past block: who owned an NFT, an estate's size, which LAND
 * and estates were in the Rentals contract. The DAO's Snapshot strategies read these at the block of
 * each proposal. And third parties on Polygon as they were at a past block, which content servers read
 * to validate a third party wearable at the block it was deployed at.
 */

export type HistoricalNftsFilters = {
  /** The Ethereum block the holdings are read at. */
  block: number
  owners: string[]
  category?: string
  contractAddresses?: string[]
  itemTypes?: string[]
  /** Only estates whose size at the block is above this. */
  estateSizeGt?: number
  /** Only NFTs whose `<contractAddress>-<tokenId>` comes after this, in that order. */
  idGt?: string
  first: number
  skip: number
}

export type HistoricalNft = {
  contractAddress: string
  tokenId: string
  category: string
  owner: string
  itemType: string | null
  searchWearableRarity: string | null
  /** For estates, the size at the block; null for anything else. */
  searchEstateSize: number | null
}

export type HistoricalEstatesFilters = {
  block: number
  tokenIds: string[]
  /** Only estates whose size at the block is above this. */
  sizeGt?: number
  /** Whether to answer each estate's parcels at the block. */
  withParcels?: boolean
  first: number
  skip: number
}

/** A LAND parcel, by its token id (decimal) and coordinates. */
export type HistoricalParcel = {
  tokenId: string
  x: number
  y: number
}

export type HistoricalEstate = {
  tokenId: string
  size: number
  /** Only when asked for, sorted by token id as text, as the subgraph sorts its parcel ids. */
  parcels?: HistoricalParcel[]
}

export type EstateParcelDBRow = {
  estate_token_id: string
  parcel_id: string
  x: number | string
  y: number | string
}

export type HistoricalRentalAssetsFilters = {
  block: number
  lessors: string[]
  contractAddresses?: string[]
  isClaimed?: boolean
  first: number
  skip: number
}

export type HistoricalRentalAsset = {
  contractAddress: string
  tokenId: string
  /** The owner who put it up for rent; null once the owner claimed it back. */
  lessor: string | null
  isClaimed: boolean
}

export type HistoricalThirdPartiesFilters = {
  /** The Polygon block the third parties are read at. */
  block: number
  ids: string[]
  isApproved?: boolean
  first: number
  skip: number
}

/** A third party as its last review up to the block left it; one never reviewed by then is left out. */
export type HistoricalThirdParty = {
  id: string
  /** The merkle root of its items. */
  root: string
  isApproved: boolean
}

export interface IHistoricalComponent {
  getNfts(filters: HistoricalNftsFilters): Promise<HistoricalNft[]>
  getEstates(filters: HistoricalEstatesFilters): Promise<HistoricalEstate[]>
  getRentalAssets(filters: HistoricalRentalAssetsFilters): Promise<HistoricalRentalAsset[]>
  getThirdParties(filters: HistoricalThirdPartiesFilters): Promise<HistoricalThirdParty[]>
}

export type OwnerAtBlockDBRow = {
  contract_address: string
  token_id: string
  category: string
  item_type: string | null
  search_wearable_rarity: string | null
  owner: string
}

export type EstateSizeDBRow = {
  estate_token_id: string
  size: number
}

export type RentalAtBlockDBRow = {
  contract_address: string
  token_id: string
  lessor: string
  claimed_at: string | null
}

export type ThirdPartyReviewDBRow = {
  third_party_id: string
  root: string
  is_approved: boolean
  block_number: number
  log_index: number
}
