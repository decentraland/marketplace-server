import BN from 'bn.js'
import seedrandom from 'seedrandom'
import { Item } from '@dcl/schemas'
import { AppComponents } from '../../types'
import { getTrendingSalesQuery } from './queries'
import { ITrendingsComponent, TrendingFilters, TrendingSaleDB } from './types'
import { findItemByItemId, fromTrendingSaleFragment, getDateXDaysAgo } from './utils'

const DEFAULT_SIZE = 20
export const SALES_CUT = 0.6
export const VOLUME_CUT = 0.4

export function createTrendingsComponent(components: Pick<AppComponents, 'dappsDatabase' | 'items' | 'picks'>): ITrendingsComponent {
  const { dappsDatabase: database, items: itemsComponent } = components

  async function fetchTrendingSales(skip: number) {
    const query = getTrendingSalesQuery({ from: getDateXDaysAgo(1).getTime(), first: 1000, skip })
    const dbSales = await database.query<TrendingSaleDB>(query)

    const sales = dbSales.rows.map(row => fromTrendingSaleFragment(row))

    return sales
  }
  /**
   * The fetch will return the trending NFTs based on the sales amount and volume.
   * The current logic gets the 60% with more sales and the 40% with more traded volume. Then uses seedrandom to shuffle the concatenated array in a deterministic order.
   * @param filters TrendingFilters
   * @returns NFT
   */
  async function fetch({ pickedBy, ...filters }: TrendingFilters) {
    const sales = await fetchTrendingSales(0)
    const trendingSales = sales.reduce((acc, sale) => {
      if (sale.itemId) {
        const key = `${sale.contractAddress}-${sale.itemId}`
        acc[key] = (acc[key] || 0) + 1
      }
      return acc
    }, {} as Record<string, number>)

    const itemsResponses = await Promise.all(
      Object.keys(trendingSales).map(key => {
        const [contractAddress, itemId] = key.split('-')
        return itemsComponent.getItems({
          contractAddresses: [contractAddress],
          itemId: itemId || undefined
        })
      })
    )

    const items = itemsResponses.map(response => response.data).reduce((a, b) => a.concat(b), [])

    const trendingBySales: Item[] = []
    new Map(
      [...Object.entries(trendingSales)].sort((a, b) => b[1] - a[1]) // sort by sales amount
    ).forEach((_value, key) => {
      const itemFromSale = findItemByItemId(items, key)
      if (itemFromSale?.isOnSale) {
        trendingBySales.push(itemFromSale)
      }
    })
    // Get 60% of the trending sales by amount
    const slicedTrendingBySales = trendingBySales.slice(0, (filters.size || DEFAULT_SIZE) * SALES_CUT)

    // Get the trending ones by volume, making sure is not being repeated with the one from the trending sales.
    // It will iterate over sales which is already ordered by volume as it was used as the SortBy parameter.
    const trendingByVolume: Item[] = []
    new Map(
      [...Object.entries(trendingSales)].sort((a, b) => {
        const itemA = findItemByItemId(items, a[0])
        const itemB = findItemByItemId(items, b[0])
        if (!itemA) {
          return 1
        }
        if (!itemB) {
          return -1
        }
        return new BN(itemB.price).mul(new BN(b[1])).gt(new BN(itemA.price).mul(new BN(a[1]))) ? 1 : -1
      }) // sort by sales amount
    ).forEach((_value, key) => {
      const itemFromSale = findItemByItemId(items, key)
      // if it's on sale and not already included in the trenging by sales array, we push it to the by volume one
      if (itemFromSale?.isOnSale && !slicedTrendingBySales.find(trendingItemBySales => trendingItemBySales.id === itemFromSale.id)) {
        trendingByVolume.push(itemFromSale)
      }
    })

    // Get 40% of the trending sales by volume
    const slicedTrendingByVolume = trendingByVolume.slice(0, (filters.size || DEFAULT_SIZE) * VOLUME_CUT)

    // Return a deterministic shuffled result using the nft.id as the seed for seedrandom
    return slicedTrendingBySales.concat(slicedTrendingByVolume).sort((item1, item2) => (seedrandom(item1.id + item2.id)() > 0.5 ? 1 : -1))
  }

  return {
    fetch
  }
}
