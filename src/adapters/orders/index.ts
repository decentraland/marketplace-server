import { Order } from '@dcl/schemas'
import { getNetwork, getNetworkChainId } from '../../logic/chainIds'
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
    expiresAt: dbOrder.expires_at.getTime(),
    createdAt: dbOrder.created_at.getTime(),
    updatedAt: dbOrder.updated_at.getTime(),
    network: getNetwork(dbOrder.network),
    chainId: getNetworkChainId(dbOrder.network),
    issuedId: dbOrder.issued_id,
    tradeId: dbOrder.trade_id
  }
}
