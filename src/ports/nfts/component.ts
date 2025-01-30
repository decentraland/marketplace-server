import { ListingStatus, NFTCategory, NFTFilters, RentalStatus } from '@dcl/schemas'
import { fromNFTsAndOrdersToNFTsResult } from '../../adapters/nfts'
import { formatQueryForLogging } from '../../controllers/handlers/utils'
import { getEthereumChainId } from '../../logic/chainIds'
import { getMarketplaceContracts } from '../../logic/contracts'
import { HttpError } from '../../logic/http/response'
import { AppComponents } from '../../types'
import { getOrdersQuery } from '../orders/queries'
import { DBOrder } from '../orders/types'
import { InvalidSearchByTenantAndOwnerError, InvalidTokenIdError, MissingContractAddressParamError } from './errors'
import { getNFTsQuery } from './queries'
import { DBNFT, INFTsComponent } from './types'
import { getNFTFilters } from './utils'

export const MAX_SUBGRAPH_QUERY_IN_ELEMENTS = 500

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
      let rentalAssetsIds: string[] = []
      // When having the owner filter, we need to look for the rental assets with that lessor
      if (filters.owner) {
        const contracts = getMarketplaceContracts(getEthereumChainId())
        const estateContract = contracts.find(contract => contract.name === 'Estates')
        const landContract = contracts.find(contract => contract.name === 'LAND')
        const rentalAssets = await rentals.getRentalAssets({
          lessors: [filters.owner],
          contractAddresses: [landContract?.address || '', estateContract?.address || ''],
          isClaimed: false,
          // In order to avoid pagination issues, we need to fetch all the assets for this owner in the rentals subgraph.
          // The number is determined by the maximum recommended number of entries a filter_in query can have.
          // It is improbable that any user will have more than MAX_SUBGRAPH_QUERY_IN_ELEMENTS Lands or Estates on rent.
          // But in the case that they do, retrieved data might be incomplete 💀
          first: MAX_SUBGRAPH_QUERY_IN_ELEMENTS
        })
        rentalAssetsIds = rentalAssets.map(
          asset => `${asset.contractAddress === estateContract?.address ? 'estate' : 'parcel'}-${asset.contractAddress}-${asset.tokenId}`
        )
      }
      query = getNFTsQuery({ ...nftFilters, rentalAssetsIds })
      const nfts = await client.query<DBNFT>(query)
      const nftIds = nfts.rows.map(nft => nft.id)
      query = getOrdersQuery({ nftIds, status: ListingStatus.OPEN, owner }, 'combined_nft_orders') // Added a specific prefix to track this queries in the logs easily
      const orders = await client.query<DBOrder>(query)

      const landNftIds = nfts.rows
        .filter(nft => nft.category === NFTCategory.PARCEL || nft.category === NFTCategory.ESTATE)
        .map(nft => nft.id)
      const listings = landNftIds.length
        ? await rentals.getRentalsListingsOfNFTs(landNftIds, filters.rentalStatus || RentalStatus.OPEN)
        : []

      return {
        data: fromNFTsAndOrdersToNFTsResult(nfts.rows, orders.rows, listings),
        total: nfts.rowCount > 0 ? Number(nfts.rows[0].count) : 0
      }
    } catch (error) {
      if ((error as Error).message === 'Query read timeout') {
        const errorInfo = {
          filters: JSON.stringify(filters),
          query: query?.text ? formatQueryForLogging(query.text) : undefined,
          values: query?.values
        }
        console.error('NFT Query timeout exceeded')
        console.dir(errorInfo, { depth: null, maxStringLength: null })
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
