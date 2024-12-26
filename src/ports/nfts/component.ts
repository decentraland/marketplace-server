import { ListingStatus, NFTCategory, NFTFilters, RentalStatus } from '@dcl/schemas'
import { fromNFTsAndOrdersToNFTsResult } from '../../adapters/nfts'
import { HttpError } from '../../logic/http/response'
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
    const client = await pg.getPool().connect()
    let query
    try {
      query = getNFTsQuery(nftFilters)
      const nfts = await client.query<DBNFT>(query)
      const nftIds = nfts.rows.map(nft => nft.id)
      query = getOrdersQuery({ nftIds, status: ListingStatus.OPEN, owner }, 'combined_nft_orders') // Added a specific prefix to track this queries in the logs easily
      const orders = await client.query<DBOrder>(query)

      const landNftIds = nfts.rows
        .filter(nft => nft.category === NFTCategory.PARCEL || nft.category === NFTCategory.ESTATE)
        .map(nft => nft.id)
      const listings = landNftIds.length ? await rentals.getRentalsListingsOfNFTs(landNftIds, RentalStatus.OPEN) : []

      return {
        data: fromNFTsAndOrdersToNFTsResult(nfts.rows, orders.rows, listings),
        total: nfts.rowCount > 0 ? Number(nfts.rows[0].count) : 0
      }
    } catch (error) {
      console.log('Errrrrorrrr', error)
      if ((error as Error).message === 'Query read timeout') {
        console.error('Query timeout exceeded (2 minutes)', {
          filters,
          query: query?.text,
          values: query?.values
        })
      }
      throw new HttpError("Couldn't fetch nfts with the filters provided", 400)
    } finally {
      await client.release()
    }
  }

  return {
    getNFTs
  }
}
