import { ListingStatus, NFTCategory, NFTFilters } from '@dcl/schemas'
import { fromNFTsAndOrdersToNFTsResult } from '../../adapters/nfts'
import { AppComponents } from '../../types'
import { getOrdersQuery } from '../orders/queries'
import { DBOrder } from '../orders/types'
import { InvalidSearchByTenantAndOwnerError, InvalidTokenIdError, MissingContractAddressParamError } from './errors'
import { getNFTsQuery } from './queries'
import { DBNFT, INFTsComponent } from './types'
import { getBannedNames } from './utils'

export function createNFTsComponent(components: Pick<AppComponents, 'dappsDatabase' | 'config'>): INFTsComponent {
  const { dappsDatabase: pg, config } = components

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
    const bannedNames = filters.category === NFTCategory.ENS ? await getBannedNames(listsServer) : []

    const nfts = await pg.query<DBNFT>(getNFTsQuery(filters, bannedNames))
    const nftIds = nfts.rows.map(nft => nft.id)
    const orders = await pg.query<DBOrder>(getOrdersQuery({ nftIds, status: ListingStatus.OPEN }))
    return {
      data: fromNFTsAndOrdersToNFTsResult(nfts.rows, orders.rows),
      total: nfts.rowCount > 0 ? nfts.rows[0].count : 0
    }
  }

  return {
    getNFTs
  }
}
