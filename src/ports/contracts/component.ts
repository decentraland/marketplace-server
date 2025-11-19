import { Contract, Network, NFTCategory } from '@dcl/schemas'
import { fromDBCollectionToContract } from '../../adapters/contracts'
import { getEthereumChainId } from '../../logic/chainIds'
import { getMarketplaceContracts as getHardcodedMarketplaceContracts } from '../../logic/contracts'
import { AppComponents } from '../../types'
import { getCollectionsCountQuery, getCollectionsQuery } from './queries'
import { ContractFilters, DBCollection, IContractsComponent } from './types'

/**
 * Creates the Contracts component
 *
 * Orchestrates contract data retrieval operations:
 * 1. Queries the database for collection contracts
 * 2. Gets hardcoded marketplace contracts
 * 3. Merges and filters results
 * 4. Applies filtering, sorting, and pagination
 *
 * @param components Required components: dappsDatabase
 * @returns IContractsComponent implementation
 */
export function createContractsComponent(components: Pick<AppComponents, 'dappsDatabase' | 'inMemoryCache'>): IContractsComponent {
  const { dappsDatabase: pg, inMemoryCache } = components

  /**
   * Retrieves all hardcoded marketplace contracts
   *
   * This method returns the hardcoded contracts for LAND, Estates, Names, and other
   * marketplace-specific collections from all chain IDs.
   *
   * @returns Array of marketplace contracts
   */
  function getMarketplaceContracts(): Contract[] {
    const ethereumChainId = getEthereumChainId()
    const ethereumMarketplaceContracts = getHardcodedMarketplaceContracts(ethereumChainId)

    return ethereumMarketplaceContracts
  }

  /**
   * Retrieves collection contracts from database
   *
   * This method queries the database for collection contracts and applies
   * filters.
   *
   * @param filters - Optional filters for querying contracts (category, network)
   * @returns Promise resolving to an object containing the contract data array and total count of contracts
   */
  async function getCollectionContracts(filters: ContractFilters = {}) {
    const [collections, count] = await Promise.all([
      pg.query<DBCollection>(getCollectionsQuery(filters)),
      pg.query<{ count: string }>(getCollectionsCountQuery(filters))
    ])

    const collectionContracts: Contract[] = collections.rows.map(dbCollection => fromDBCollectionToContract(dbCollection))

    return {
      data: collectionContracts,
      total: Number(count.rows?.[0]?.count ?? 0)
    }
  }

  /**
   * Retrieves all collection contracts from database using pagination
   *
   * This method fetches all collection contracts by paginating through results
   * with a page size of 500. Filters for category and network are applied at
   * the SQL level to minimize memory usage.
   *
   * Results are cached for 1 hour to improve performance.
   *
   * @param filters - Optional filters for category and network (first/skip are ignored)
   * @returns Promise resolving to an array of all collection contracts
   */
  async function getAllCollectionContracts() {
    const ALL_COLLECTION_CONTRACTS_CACHE_KEY = 'all_collection_contracts'
    const CACHE_TTL_IN_SECONDS = 60 * 60 // 1 hour

    const cachedContracts = await inMemoryCache.get<Contract[]>(ALL_COLLECTION_CONTRACTS_CACHE_KEY)

    if (cachedContracts) {
      return cachedContracts
    }

    const PAGE_SIZE = 500
    const allCollectionContracts: Contract[] = []

    const countResult = await pg.query<{ count: string }>(getCollectionsCountQuery({}))
    const total = Number(countResult.rows?.[0]?.count ?? 0)

    if (total === 0) {
      return allCollectionContracts
    }

    let skip = 0
    while (skip < total) {
      const collections = await pg.query<DBCollection>(
        getCollectionsQuery({
          first: PAGE_SIZE,
          skip
        })
      )

      const collectionContracts: Contract[] = collections.rows.map(dbCollection => fromDBCollectionToContract(dbCollection))
      allCollectionContracts.push(...collectionContracts)
      skip += PAGE_SIZE
    }

    await inMemoryCache.set(ALL_COLLECTION_CONTRACTS_CACHE_KEY, allCollectionContracts, CACHE_TTL_IN_SECONDS)

    return allCollectionContracts
  }

  /**
   * Retrieves all contracts (marketplace + collections) without pagination or filters
   *
   * This method fetches all marketplace contracts and all collection contracts
   * by calling getAllCollectionContracts which paginates with a page size of 500.
   * The results are merged and sorted by name.
   *
   * This is used for legacy reasons and replaced in the future.
   *
   * @param filters - Optional filters for category and network
   * @returns Promise resolving to an object containing all contract data and total count
   */
  async function getContracts(filters: ContractFilters = {}) {
    let marketplaceContracts = getMarketplaceContracts()

    if (filters.category) {
      marketplaceContracts = marketplaceContracts.filter(contract => contract.category === filters.category)
    }
    if (filters.network) {
      marketplaceContracts = marketplaceContracts.filter(contract => contract.network === filters.network)
    }

    const shouldFetchAllCollectionContracts =
      (!filters.category || filters.category === NFTCategory.WEARABLE) && (!filters.network || filters.network === Network.MATIC)
    const allCollectionContracts = shouldFetchAllCollectionContracts ? await getAllCollectionContracts() : []

    const allContracts = [...marketplaceContracts, ...allCollectionContracts]

    return {
      data: allContracts,
      total: allContracts.length
    }
  }

  return {
    getContracts,
    getMarketplaceContracts,
    getCollectionContracts,
    getAllCollectionContracts
  }
}
