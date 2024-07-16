import { ListingStatus, Network, Bid } from '@dcl/schemas'
import { DBBid } from '../../ports/bids'

export function fromDBBidToBid(dbBid: DBBid): Bid {
  return {
    id: dbBid.trade_id,
    tradeId: dbBid.trade_id,
    bidder: dbBid.bidder,
    price: dbBid.price,
    createdAt: dbBid.created_at.getTime(),
    updatedAt: dbBid.updated_at.getTime(),
    ...(dbBid.token_id !== null ? { tokenId: dbBid.token_id } : { itemId: dbBid.item_id }),
    fingerprint: dbBid.fingerprint || '',
    status: ListingStatus.CANCELLED, // TODO: complete status
    seller: '', // TODO: complete seller
    network: dbBid.network as Network.ETHEREUM | Network.MATIC,
    chainId: dbBid.chain_id,
    contractAddress: dbBid.contract_address,
    expiresAt: dbBid.expires_at.getTime()
  }
}
