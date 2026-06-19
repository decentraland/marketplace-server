import { Network } from '@dcl/schemas'

/**
 * A MANA movement in a wallet's history, derived from on-chain ERC20 `Transfer` logs.
 *
 * - `send` / `received`: plain MANA transfers out of / into the wallet.
 * - `swap`: a Polygon PoS bridge deposit (Ethereum→Polygon). Anchored on the L1 deposit; the L2
 *   mint that credits Polygon is correlated and exposed as `counterpartHash` (not a separate row).
 * - `withdraw`: a Polygon PoS bridge withdrawal (Polygon→Ethereum). Anchored on the L2 burn; the L1
 *   exit is correlated and exposed as `counterpartHash`.
 */
export enum ManaTransferType {
  SEND = 'send',
  RECEIVED = 'received',
  SWAP = 'swap',
  WITHDRAW = 'withdraw'
}

/**
 * `confirmed`: the movement is fully settled on its destination chain.
 * `bridging`: a swap/withdraw whose origin leg is mined but whose destination leg (the bridge
 * credit/exit) has not been observed yet (~20-30 min PoS checkpoint window).
 */
export enum ManaTransferStatus {
  CONFIRMED = 'confirmed',
  BRIDGING = 'bridging'
}

export type ManaTransfer = {
  hash: string
  type: ManaTransferType
  network: Network
  from: string
  to: string
  // Human-readable MANA amount (formatEther of `value`).
  amount: string
  // Raw amount in wei, as a decimal string (lossless; clients reconcile by hash, not amount).
  value: string
  // Milliseconds since epoch (from the log's blockTimestamp).
  timestamp: number
  status: ManaTransferStatus
  // For a swap: the L2 mint tx hash once Polygon is credited. For a withdraw: the L1 exit tx hash
  // once completed. Undefined while still `bridging`. Best-effort: the two bridge legs share no
  // on-chain id, so they are correlated by exact wei amount + chronological order — for two
  // in-flight transfers of the identical amount the paired hash (and status) may be swapped.
  counterpartHash?: string
}

export type IManaTransfersComponent = {
  getManaTransfers(address: string): Promise<{ data: ManaTransfer[]; total: number }>
}

/**
 * Raw `eth_getLogs` entry as returned by the DCL RPC. The DCL RPC (Alchemy) includes
 * `blockTimestamp` on each log, so the transfer date is read from the log itself without an extra
 * `eth_getBlockByNumber` call.
 */
export type RawTransferLog = {
  address: string
  topics: string[]
  data: string
  blockNumber: string
  blockTimestamp?: string
  transactionHash: string
  logIndex: string
  removed?: boolean
}

/** A decoded MANA `Transfer` event, normalized (lowercased addresses) for classification. */
export type DecodedTransfer = {
  network: Network
  from: string
  to: string
  value: bigint
  hash: string
  logIndex: number
  blockNumber: number
  // Milliseconds since epoch; 0 when the RPC omitted blockTimestamp.
  timestamp: number
}
