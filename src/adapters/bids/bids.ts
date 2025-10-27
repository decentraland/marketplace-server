import { Network, Bid, ChainId, ListingStatus } from '@dcl/schemas'
import { getEthereumChainId, getPolygonChainId } from '../../logic/chainIds'
import { DBBid, DBNetwork } from '../../ports/bids'
import { SquidNetwork } from '../../types'

export function getChainIdFromDBBid(dbBid: DBBid): ChainId {
  if (dbBid.chain_id) {
    return dbBid.chain_id
  }

  return [SquidNetwork.ETHEREUM, Network.ETHEREUM].includes(dbBid.network) ? getEthereumChainId() : getPolygonChainId()
}

export function fromDBNetworkToNetwork(dbNetwork: DBNetwork): Network.ETHEREUM | Network.MATIC {
  if (dbNetwork === SquidNetwork.ETHEREUM || dbNetwork === Network.ETHEREUM) {
    return Network.ETHEREUM
  }

  return Network.MATIC
}

export function fromDBBidToBid(dbBid: DBBid): Bid {
  return {
    bidder: dbBid.bidder,
    price: dbBid.price,
    createdAt: dbBid.created_at.getTime(),
    updatedAt: dbBid.updated_at.getTime(),
    fingerprint: dbBid.fingerprint || '',
    status: dbBid.status || ListingStatus.OPEN, // TODO: handle new bid trades status
    seller: dbBid.seller,
    network: fromDBNetworkToNetwork(dbBid.network),
    chainId: getChainIdFromDBBid(dbBid),
    contractAddress: dbBid.contract_address,
    expiresAt: dbBid.expires_at.getTime(),
    ...(dbBid.trade_id !== null
      ? {
          id: dbBid.trade_id,
          tradeId: dbBid.trade_id,
          tradeContractAddress: dbBid.trade_contract_address,
          ...(dbBid.token_id !== null ? { tokenId: dbBid.token_id } : { itemId: dbBid.item_id })
        }
      : {
          id: dbBid.legacy_bid_id,
          bidAddress: dbBid.bid_address,
          blockchainId: dbBid.blockchain_id,
          blockNumber: dbBid.block_number,
          tokenId: dbBid.token_id
        })
  }
}
