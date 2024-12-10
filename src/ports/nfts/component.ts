import { ListingStatus, NFTCategory, NFTFilters, RentalStatus } from '@dcl/schemas'
import { fromNFTsAndOrdersToNFTsResult } from '../../adapters/nfts'
import { AppComponents } from '../../types'
import { getOrdersQuery } from '../orders/queries'
import { DBOrder } from '../orders/types'
import { InvalidSearchByTenantAndOwnerError, InvalidTokenIdError, MissingContractAddressParamError } from './errors'
import { getNFTsQuery } from './queries'
import { DBNFT, INFTsComponent } from './types'
import { getNFTFilters } from './utils'

export function createNFTsComponent(components: Pick<AppComponents, 'dappsDatabase' | 'config' | 'rentals'>): INFTsComponent {
  const { dappsDatabase: pg, config, rentals } = components

  async function getNFTs(filters: NFTFilters) {
    const { owner, tenant, tokenId, contractAddresses } = filters
    if (owner && tenant) {
      throw new InvalidSearchByTenantAndOwnerError()
    }

    if (tokenId && !tokenId.match('^[0-9]+$')) {
      throw new InvalidTokenIdError()
    }

    if (tokenId && contractAddresses?.length === 0) {
      throw new MissingContractAddressParamError()
    }

    const listsServer = await config.requireString('DCL_LISTS_SERVER')
    const nftFilters = await getNFTFilters(filters, listsServer, rentals)
    const nftsQuery = getNFTsQuery(nftFilters)
    const nfts = await pg.query<DBNFT>(nftsQuery)
    const nftIds = nfts.rows.map(nft => nft.id)
    const query = getOrdersQuery({ nftIds, status: ListingStatus.OPEN })
    const orders = await pg.query<DBOrder>(query)

    const landNftIds = nfts.rows
      .filter(nft => nft.category === NFTCategory.PARCEL || nft.category === NFTCategory.ESTATE)
      .map(nft => nft.id)
    const listings = landNftIds.length ? await rentals.getRentalsListingsOfNFTs(landNftIds, RentalStatus.OPEN) : []

    return {
      data: fromNFTsAndOrdersToNFTsResult(nfts.rows, orders.rows, listings),
      total: nfts.rowCount > 0 ? Number(nfts.rows[0].count) : 0
    }
  }

  return {
    getNFTs
  }
}
