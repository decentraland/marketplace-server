import { getNetwork, getNetworkChainId } from '../../logic/chainIds'
import { fromSecondsToMilliseconds } from '../../logic/date'
import { Collection, DBCollection } from '../../ports/collections/types'

export function fromDBCollectionToCollection(dbCollection: DBCollection): Collection {
  return {
    urn: dbCollection.urn,
    creator: dbCollection.creator,
    name: dbCollection.name,
    contractAddress: dbCollection.id,
    createdAt: fromSecondsToMilliseconds(dbCollection.created_at),
    updatedAt: fromSecondsToMilliseconds(dbCollection.updated_at),
    reviewedAt: fromSecondsToMilliseconds(dbCollection.reviewed_at),
    isOnSale: dbCollection.search_is_store_minter,
    size: dbCollection.items_count,
    network: getNetwork(dbCollection.network),
    chainId: getNetworkChainId(dbCollection.network),
    firstListedAt: dbCollection.first_listed_at ? fromSecondsToMilliseconds(dbCollection.first_listed_at) : null
  }
}
