import { EmoteCategory, NFT, NFTCategory, WearableCategory } from '@dcl/schemas'
import { getNetwork, getNetworkChainId } from '../../logic/chainIds'
import { capitalize } from '../../logic/strings'
import { DBNFT, ItemType } from '../../ports/nfts/types'

function getDataFromDBNFT(dbNFT: DBNFT): NFT['data'] {
  if (dbNFT.category === NFTCategory.WEARABLE) {
    return {
      wearable: {
        bodyShapes: dbNFT.body_shapes,
        category: dbNFT.wearableCategory as WearableCategory,
        description: dbNFT.description || '',
        rarity: dbNFT.rarity,
        isSmart: dbNFT.item_type === ItemType.SMART_WEARABLE_V1
      }
    }
  }

  if (dbNFT.category === NFTCategory.PARCEL) {
    return {
      parcel: {
        x: dbNFT.x as string,
        y: dbNFT.y as string,
        description: dbNFT.description || null,
        estate: dbNFT.parcel_estate_id
          ? { name: dbNFT.parcel_estate_name || capitalize(NFTCategory.ESTATE), tokenId: dbNFT.parcel_estate_token_id || '' }
          : null
      }
    }
  }

  if (dbNFT.category === NFTCategory.ENS) {
    return {
      ens: {
        subdomain: dbNFT.subdomain as string
      }
    }
  }

  if (dbNFT.category === NFTCategory.ESTATE) {
    return {
      estate: {
        size: dbNFT.size || 0,
        description: dbNFT.description || null,
        parcels: dbNFT.estate_parcels || []
      }
    }
  }

  return {
    emote: {
      bodyShapes: dbNFT.body_shapes,
      category: dbNFT.emoteCategory as EmoteCategory,
      description: dbNFT.description || '',
      rarity: dbNFT.rarity,
      loop: dbNFT.loop || false,
      hasSound: dbNFT.has_sound || false,
      hasGeometry: dbNFT.has_geometry || false
    }
  }
}

export function fromDBNFTToNFT(dbNFT: DBNFT): NFT {
  return {
    activeOrderId: null,
    category: dbNFT.category,
    chainId: getNetworkChainId(dbNFT.network),
    contractAddress: dbNFT.contract_address,
    createdAt: dbNFT.created_at,
    data: getDataFromDBNFT(dbNFT),
    id: dbNFT.id,
    image: dbNFT.image,
    issuedId: dbNFT.issued_id,
    itemId: dbNFT.item_id,
    name: dbNFT.name || capitalize(dbNFT.category),
    network: getNetwork(dbNFT.network),
    openRentalId: null,
    owner: dbNFT.owner.toLowerCase(),
    tokenId: dbNFT.token_id,
    soldAt: 0, // TODO: Calculate sold at
    updatedAt: dbNFT.updated_at,
    url: `/contracts/${dbNFT.contract_address}/tokens/${dbNFT.token_id}`
  }
}