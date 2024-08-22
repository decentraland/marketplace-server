import { NFTFilters } from '@dcl/schemas'
import { fromDBNFTToNFT } from '../../adapters/nfts'
import { AppComponents } from '../../types'
import { InvalidSearchByTenantAndOwnerError, InvalidTokenIdError, MissingContractAddressParamError } from './errors'
import { getNFTsQuery } from './queries'
import { DBNFT, INFTsComponent } from './types'

export function createNFTsComponent(components: Pick<AppComponents, 'dappsDatabase'>): INFTsComponent {
  const { dappsDatabase: pg } = components

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

    // TODO: Add banned names filters
    const result = await pg.query<DBNFT>(getNFTsQuery(filters))
    return { data: result.rows.map(dbNFT => ({ nft: fromDBNFTToNFT(dbNFT), order: null, rental: null })), total: result.rowCount }
  }

  return {
    getNFTs
  }
}
