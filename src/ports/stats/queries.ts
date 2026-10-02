import SQL from 'sql-template-strings'
import { NFTCategory } from '@dcl/schemas'
import { PausedContract } from '../contract-status/types'
import { getNFTsQuery } from '../nfts/queries'
import { GetNFTsFilters } from '../nfts/types'
import { StatsResourceFilters } from './types'

export function getEstatesSizesQuery(filters: StatsResourceFilters, pausedContracts: PausedContract[]) {
  const nftQueryFilters: GetNFTsFilters = {
    ...filters,
    category: NFTCategory.ESTATE
  }
  return SQL`SELECT size FROM (`.append(getNFTsQuery(nftQueryFilters, pausedContracts, true)).append(SQL`) as nfts`)
}
