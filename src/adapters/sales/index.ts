import { Sale } from '@dcl/schemas'
import { getNetwork, getNetworkChainId } from '../../logic/chainIds'
import { DBSale } from '../../ports/sales'

export function fromDBSaleToSale(dbSale: DBSale): Sale {
  return {
    id: dbSale.id,
    itemId: dbSale.item_id,
    contractAddress: dbSale.contract_address,
    buyer: dbSale.buyer,
    chainId: getNetworkChainId(dbSale.network),
    network: getNetwork(dbSale.network),
    price: dbSale.price,
    seller: dbSale.seller,
    timestamp: dbSale.timestamp,
    tokenId: dbSale.token_id,
    txHash: dbSale.tx_hash,
    type: dbSale.type
  }
}
