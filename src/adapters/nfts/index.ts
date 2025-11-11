import { EmoteCategory, NFT, NFTCategory, RentalListing, WearableCategory } from '@dcl/schemas'
import { getNetwork, getNetworkChainId } from '../../logic/chainIds'
import { fromSecondsToMilliseconds } from '../../logic/date'
import { capitalize } from '../../logic/strings'
import { ItemType } from '../../ports/items'
import { DBNFT, NFTResult } from '../../ports/nfts/types'
import { fixUrn } from '../../ports/nfts/utils'
import { DBOrder } from '../../ports/orders/types'
import { fromDBOrderToOrder } from '../orders'

function getDataFromDBNFT(dbNFT: DBNFT): NFT['data'] {
  if (dbNFT.category === NFTCategory.WEARABLE) {
    return {
      wearable: {
        bodyShapes: dbNFT.body_shapes,
        category: dbNFT.wearable_category as WearableCategory,
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
      category: dbNFT.emote_category as EmoteCategory,
      description: dbNFT.description || '',
      rarity: dbNFT.rarity,
      loop: dbNFT.loop || false,
      hasSound: dbNFT.has_sound || false,
      hasGeometry: dbNFT.has_geometry || false,
      outcomeType: dbNFT.emote_outcome_type || null
    }
  }
}

export function fromDBNFTToNFT(dbNFT: DBNFT): NFT {
  return {
    activeOrderId: null,
    category: dbNFT.category,
    chainId: getNetworkChainId(dbNFT.network),
    contractAddress: dbNFT.contract_address,
    createdAt: fromSecondsToMilliseconds(Number(dbNFT.created_at)),
    data: getDataFromDBNFT(dbNFT),
    id: `${dbNFT.contract_address}-${dbNFT.token_id}`,
    image: fixUrn(dbNFT.image || ''),
    issuedId: dbNFT.issued_id,
    itemId: dbNFT.item_id,
    name: dbNFT.name || capitalize(dbNFT.category),
    network: getNetwork(dbNFT.network),
    openRentalId: null,
    owner: dbNFT.owner_id ? dbNFT.owner_id?.split('-')[0] : dbNFT.owner ? dbNFT.owner : '', // the owner_id is the account address plus '-' + network.
    tokenId: dbNFT.token_id,
    soldAt: 0, // TODO: Calculate sold at
    updatedAt: fromSecondsToMilliseconds(Number(dbNFT.updated_at)), // Convert to ms
    url: `/contracts/${dbNFT.contract_address}/tokens/${dbNFT.token_id}`,
    urn: dbNFT.urn ? fixUrn(dbNFT.urn) : undefined
  }
}

export function fromNFTsAndOrdersToNFTsResult(nfts: DBNFT[], orders: DBOrder[], listings: RentalListing[]): NFTResult[] {
  return nfts.map(nft => {
    const order = orders.find(order => order.nft_id === nft.id)
    const listing = listings.find(listing => listing.nftId === nft.id)
    return {
      nft: {
        ...fromDBNFTToNFT(nft),
        activeOrderId: order ? order.id : null,
        openRentalId: listing ? listing.id : null
      },
      order: order ? fromDBOrderToOrder(order) : null,
      rental: listing ? listing : null
    }
  })
}
