import SQL from 'sql-template-strings'
import { NFTCategory } from '@dcl/schemas'
import { getNFTsQuery } from '../nfts/queries'
import { GetNFTsFilters } from '../nfts/types'
import { StatsResourceFilters } from './types'

export function getEstatesSizesQuery(filters: StatsResourceFilters) {
  const nftQueryFilters: GetNFTsFilters = {
    ...filters,
    category: NFTCategory.ESTATE
  }
  return SQL`SELECT size FROM (`.append(getNFTsQuery(nftQueryFilters, true)).append(SQL`) as nfts`)
}
