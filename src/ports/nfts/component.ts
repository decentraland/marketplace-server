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
    console.log('listsServer: ', listsServer)
    const nftFilters = await getNFTFilters(filters, listsServer, rentals)
    console.log('getNFTsQuery(nftFilters): ', getNFTsQuery(nftFilters).text)
    const nfts = await pg.query<DBNFT>(getNFTsQuery(nftFilters))
    console.log('nfts: ', nfts)
    const nftIds = nfts.rows.map(nft => nft.id)
    console.log('nftIds: ', nftIds)
    const orders = await pg.query<DBOrder>(getOrdersQuery({ nftIds, status: ListingStatus.OPEN }))
    console.log('orders: ', orders)

    const landNftIds = nfts.rows
      .filter(nft => nft.category === NFTCategory.PARCEL || nft.category === NFTCategory.ESTATE)
      .map(nft => nft.id)
    console.log('landNftIds: ', landNftIds)
    const listings = landNftIds.length ? await rentals.getRentalsListingsOfNFTs(landNftIds, RentalStatus.OPEN) : []
    console.log('listings: ', listings)

    return {
      data: fromNFTsAndOrdersToNFTsResult(nfts.rows, orders.rows, listings),
      total: nfts.rowCount > 0 ? Number(nfts.rows[0].count) : 0
    }
  }

  return {
    getNFTs
  }
}
