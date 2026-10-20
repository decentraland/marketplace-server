import { getNetwork, getNetworkChainId } from '../../logic/chainIds'
import { DBTransfer, Transfer } from '../../ports/transfers/types'

export function fromDBTransferToTransfer(row: DBTransfer): Transfer {
  return {
    id: row.id,
    from: row.from,
    to: row.to,
    contractAddress: row.contract_address,
    tokenId: row.token_id,
    itemId: row.item_id,
    category: row.category,
    txHash: row.tx_hash,
    timestamp: Number(row.timestamp),
    network: getNetwork(row.network),
    chainId: getNetworkChainId(row.network)
  }
}
