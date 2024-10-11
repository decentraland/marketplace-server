import SQL from 'sql-template-strings'
import { NFTCategory, NFTFilters } from '@dcl/schemas'
import { getCollectionsItemsCatalogQuery } from '../catalog/queries'
import { getNFTsQuery } from '../nfts/queries'
import { PriceFilters } from './types'
import { fromPriceFiltersToCatalogFilters, fromPriceFiltersToNFTFilters, isFetchingLand } from './utils'

export function getPricesQuery(filters: PriceFilters) {
  if (isFetchingLand(filters) || filters.category === NFTCategory.ENS) {
    const nftFilters: NFTFilters = {
      ...fromPriceFiltersToNFTFilters(filters),
      isOnSale: true
    }
    return SQL`SELECT price FROM (`.append(getNFTsQuery(nftFilters)).append(SQL`) as nfts`)
  }

  const catalogFilters = {
    ...fromPriceFiltersToCatalogFilters(filters),
    isOnSale: true
  }

  return SQL`SELECT COALESCE(catalog.price, catalog.min_price) as price FROM (`
    .append(getCollectionsItemsCatalogQuery(catalogFilters))
    .append(SQL`) as catalog`)
}
