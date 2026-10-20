import { ChainId, Network, NFTCategory } from '@dcl/schemas'
import { SquidNetwork } from '../../types'

export interface ITransfersComponent {
  /**
   * The most recent transfers an address sent or received, newest first.
   *
   * Mints, transfers to oneself and the transfers that settled a sale or a trade are left out: those already show up
   * as purchases. The squid keeps one transfer per NFT per block, so a hop through the address within one block is not
   * seen.
   *
   * @param filters - The address and how many transfers to return at most.
   */
  getTransfers(filters: TransferFilters): Promise<Transfer[]>
}

export type TransferFilters = {
  address: string
  first: number
}

export type Transfer = {
  id: string
  from: string
  to: string
  contractAddress: string
  tokenId: string
  itemId: string | null
  category: NFTCategory
  txHash: string
  /** Milliseconds, like every other activity timestamp. */
  timestamp: number
  network: Network.ETHEREUM | Network.MATIC
  chainId: ChainId
}

export type DBTransfer = {
  id: string
  from: string
  to: string
  contract_address: string
  token_id: string
  item_id: string | null
  category: NFTCategory
  tx_hash: string
  timestamp: string
  network: SquidNetwork | Network.MATIC | Network.ETHEREUM
}
