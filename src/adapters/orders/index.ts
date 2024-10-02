import { Order } from '@dcl/schemas'
import { getNetwork, getNetworkChainId } from '../../logic/chainIds'
import { fromSecondsToMilliseconds } from '../../logic/date'
import { DBOrder } from '../../ports/orders/types'

export function fromDBOrderToOrder(dbOrder: DBOrder): Order {
  return {
    id: dbOrder.id,
    marketplaceAddress: dbOrder.marketplace_address,
    contractAddress: dbOrder.nft_address,
    tokenId: dbOrder.token_id,
    owner: dbOrder.owner,
    buyer: dbOrder.buyer,
    price: dbOrder.price,
    status: dbOrder.status,
    expiresAt: Number(dbOrder.expires_at), // this is left as seconds to identify old orders
    createdAt: fromSecondsToMilliseconds(dbOrder.created_at),
    updatedAt: fromSecondsToMilliseconds(dbOrder.updated_at),
    network: getNetwork(dbOrder.network),
    chainId: getNetworkChainId(dbOrder.network),
    issuedId: dbOrder.issued_id,
    tradeId: dbOrder.trade_id
  }
}
