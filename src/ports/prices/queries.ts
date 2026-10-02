import SQL from 'sql-template-strings'
import { NFTCategory, NFTFilters } from '@dcl/schemas'
import { getCollectionsItemsCatalogQueryWithTrades } from '../catalog/queries'
import { PausedContract } from '../contract-status/types'
import { getNFTsQuery } from '../nfts/queries'
import { PriceFilters } from './types'
import { fromPriceFiltersToCatalogFilters, fromPriceFiltersToNFTFilters, isFetchingLand } from './utils'

export function getPricesQuery(filters: PriceFilters, pausedContracts: PausedContract[]) {
  if (isFetchingLand(filters) || filters.category === NFTCategory.ENS) {
    const nftFilters: NFTFilters = {
      ...fromPriceFiltersToNFTFilters(filters),
      isOnSale: true
    }
    return SQL`SELECT price FROM (`.append(getNFTsQuery({ ...nftFilters, sortBy: undefined }, pausedContracts, true)).append(SQL`) as nfts`)
  }

  const catalogFilters = {
    ...fromPriceFiltersToCatalogFilters(filters),
    isOnSale: true
  }

  return SQL`SELECT COALESCE(catalog.price, catalog.min_price) as price FROM (`
    .append(getCollectionsItemsCatalogQueryWithTrades(catalogFilters, pausedContracts))
    .append(SQL`) as catalog`)
}
