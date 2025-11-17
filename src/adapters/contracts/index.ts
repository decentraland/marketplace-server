import { Contract, NFTCategory } from '@dcl/schemas'
import { getNetwork, getNetworkChainId } from '../../logic/chainIds'
import { DBCollection } from '../../ports/contracts/types'

enum ItemType {
  EMOTE_V1 = 'emote_v1',
  WEARABLE_V1 = 'wearable_v1',
  WEARABLE_V2 = 'wearable_v2',
  SMART_WEARABLE_V1 = 'smart_wearable_v1'
}

export function fromDBCollectionToContracts(dbCollection: DBCollection): Contract[] {
  const network = getNetwork(dbCollection.network)
  const chainId = getNetworkChainId(dbCollection.network)
  const contracts: Contract[] = []

  const hasEmotes = dbCollection.item_types.some((itemType: string) => itemType === ItemType.EMOTE_V1)

  const hasWearables = dbCollection.item_types.some((itemType: string) =>
    [ItemType.WEARABLE_V1, ItemType.WEARABLE_V2, ItemType.SMART_WEARABLE_V1].includes(itemType as ItemType)
  )

  // Add wearable contract if collection has wearables
  if (hasWearables) {
    contracts.push({
      name: dbCollection.name,
      address: dbCollection.id,
      category: NFTCategory.WEARABLE,
      network,
      chainId
    })
  }

  // Add emote contract if collection has emotes
  if (hasEmotes) {
    contracts.push({
      name: dbCollection.name,
      address: dbCollection.id,
      category: NFTCategory.EMOTE,
      network,
      chainId
    })
  }

  return contracts
}
