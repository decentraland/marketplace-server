/**
 * Holdings on Ethereum as they were at a past block: who owned an NFT, an estate's size, which LAND
 * and estates were in the Rentals contract. The DAO's Snapshot strategies read these at the block of
 * each proposal.
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
  first: number
  skip: number
}

export type HistoricalEstate = {
  tokenId: string
  size: number
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

export interface IHistoricalComponent {
  getNfts(filters: HistoricalNftsFilters): Promise<HistoricalNft[]>
  getEstates(filters: HistoricalEstatesFilters): Promise<HistoricalEstate[]>
  getRentalAssets(filters: HistoricalRentalAssetsFilters): Promise<HistoricalRentalAsset[]>
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
