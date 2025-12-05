import { Contract, NFTCategory } from '@dcl/schemas'
import { getNetwork, getNetworkChainId } from '../../logic/chainIds'
import { DBCollection } from '../../ports/contracts/types'

export function fromDBCollectionToContract(dbCollection: DBCollection): Contract {
  return {
    name: dbCollection.name,
    address: dbCollection.id,
    category: NFTCategory.WEARABLE,
    network: getNetwork(dbCollection.network),
    chainId: getNetworkChainId(dbCollection.network)
  }
}
