import { formatEther } from 'ethers'
import { ChainId, Network } from '@dcl/schemas'
import { isAddressZero } from '../../logic/address'
import { DecodedTransfer, ManaTransfer, ManaTransferStatus, ManaTransferType, RawTransferLog } from './types'

// keccak256("Transfer(address,address,uint256)")
export const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** MANA token + Polygon PoS ERC20 predicate per chain. Mirrors sites' manaContract.ts/bridgeContract.ts. */
export type BridgeAddresses = {
  // MANA ERC20 contract on this chain (lowercased).
  mana: string
  // ERC20 predicate the L1 deposit transfers MANA to (lowercased). Only meaningful on L1 (Ethereum);
  // on L2 (Polygon) the bridge credits via a mint from the zero address, so this is empty.
  erc20Predicate: string
}

export const BRIDGE_ADDRESSES: Partial<Record<ChainId, BridgeAddresses>> = {
  [ChainId.ETHEREUM_MAINNET]: {
    mana: '0x0f5d2fb29fb7d3cfee444a200298f468908cc942',
    erc20Predicate: '0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf'
  },
  [ChainId.ETHEREUM_SEPOLIA]: {
    mana: '0xfa04d2e2ba9aec166c93dfeeba7427b2303befa9',
    erc20Predicate: '0x4258c75b752c812b7fa586bdeb259f2d4bd17f4f'
  },
  [ChainId.MATIC_MAINNET]: {
    mana: '0xa1c57f48f0deb89f569dfbe6e2b7f46d33606fd4',
    erc20Predicate: ''
  },
  [ChainId.MATIC_AMOY]: {
    mana: '0x7ad72b9f944ea9793cf4055d88f81138cc2c63a0',
    erc20Predicate: ''
  }
}

export function getRpcUrlByChainId(chainId: ChainId): string {
  switch (chainId) {
    case ChainId.ETHEREUM_MAINNET:
      return 'https://rpc.decentraland.org/mainnet'
    case ChainId.ETHEREUM_SEPOLIA:
      return 'https://rpc.decentraland.org/sepolia'
    case ChainId.MATIC_MAINNET:
      return 'https://rpc.decentraland.org/polygon'
    case ChainId.MATIC_AMOY:
      return 'https://rpc.decentraland.org/amoy'
    default:
      throw new Error(`Unsupported chainId ${chainId}`)
  }
}

export function getBridgeAddresses(chainId: ChainId): BridgeAddresses {
  const addresses = BRIDGE_ADDRESSES[chainId]
  if (!addresses) {
    throw new Error(`No MANA/bridge addresses configured for chainId ${chainId}`)
  }
  return addresses
}

/** 20-byte address → 32-byte left-padded topic (lowercased), for the indexed `from`/`to` filter. */
export function addressToTopic(address: string): string {
  return `0x000000000000000000000000${address.slice(2).toLowerCase()}`
}

/** 32-byte indexed topic → 20-byte address (lowercased). */
export function topicToAddress(topic: string): string {
  return `0x${topic.slice(26).toLowerCase()}`
}

export function decodeTransferLog(log: RawTransferLog, network: Network): DecodedTransfer {
  return {
    network,
    from: topicToAddress(log.topics[1]),
    to: topicToAddress(log.topics[2]),
    value: BigInt(log.data),
    hash: log.transactionHash.toLowerCase(),
    logIndex: parseInt(log.logIndex, 16),
    blockNumber: parseInt(log.blockNumber, 16),
    timestamp: log.blockTimestamp ? parseInt(log.blockTimestamp, 16) * 1000 : 0
  }
}

type Leg = 'deposit' | 'credit' | 'burn' | 'exit' | 'send' | 'received' | 'other'

/**
 * Classifies a decoded transfer relative to `user`. `predicate` is the L1 ERC20 predicate address
 * (empty on L2). Bridge legs:
 * - L1 `deposit` (swap origin): from === user, to === predicate.
 * - L1 `exit` (withdraw close): from === predicate, to === user.
 * - L2 `credit` (swap credit): from === 0x0 (mint), to === user.
 * - L2 `burn` (withdraw origin): from === user, to === 0x0.
 */
export function classifyLeg(transfer: DecodedTransfer, user: string, predicate: string): Leg {
  const normalizedUser = user.toLowerCase()
  const normalizedPredicate = predicate.toLowerCase()
  const isFromUser = transfer.from === normalizedUser
  const isToUser = transfer.to === normalizedUser

  if (transfer.network === Network.ETHEREUM) {
    if (normalizedPredicate && isFromUser && transfer.to === normalizedPredicate) return 'deposit'
    if (normalizedPredicate && isToUser && transfer.from === normalizedPredicate) return 'exit'
    if (isFromUser) return 'send'
    if (isToUser) return 'received'
    return 'other'
  }

  if (isAddressZero(transfer.from) && isToUser) return 'credit'
  if (isFromUser && isAddressZero(transfer.to)) return 'burn'
  if (isFromUser) return 'send'
  if (isToUser) return 'received'
  return 'other'
}

function legKey(transfer: DecodedTransfer): string {
  return `${transfer.network}-${transfer.hash}-${transfer.logIndex}`
}

function byChronology(a: DecodedTransfer, b: DecodedTransfer): number {
  return a.timestamp - b.timestamp || a.blockNumber - b.blockNumber
}

/**
 * Greedy FIFO correlation of bridge origin legs (deposits/burns) with their closing legs
 * (credits/exits). There is NO common id between the two chains' Transfer logs (the L1 StateSynced
 * id never appears on the L2 mint), so origins are matched to the earliest unused closing with the
 * exact same wei value that did not happen before the origin. Each closing is consumed once.
 */
export function correlateFifo(origins: DecodedTransfer[], closings: DecodedTransfer[]): Map<string, DecodedTransfer> {
  const sortedOrigins = [...origins].sort(byChronology)
  const sortedClosings = [...closings].sort(byChronology)
  const consumed = new Set<string>()
  const matches = new Map<string, DecodedTransfer>()

  for (const origin of sortedOrigins) {
    const match = sortedClosings.find(
      closing => !consumed.has(legKey(closing)) && closing.value === origin.value && closing.timestamp >= origin.timestamp
    )
    if (match) {
      consumed.add(legKey(match))
      matches.set(legKey(origin), match)
    }
  }

  return matches
}

function dedupeTransfers(transfers: DecodedTransfer[]): DecodedTransfer[] {
  const seen = new Set<string>()
  const result: DecodedTransfer[] = []
  for (const transfer of transfers) {
    const key = legKey(transfer)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(transfer)
    }
  }
  return result
}

function toManaTransfer(
  transfer: DecodedTransfer,
  type: ManaTransferType,
  status: ManaTransferStatus,
  counterpartHash?: string
): ManaTransfer {
  return {
    hash: transfer.hash,
    type,
    network: transfer.network,
    from: transfer.from,
    to: transfer.to,
    amount: formatEther(transfer.value),
    value: transfer.value.toString(),
    timestamp: transfer.timestamp,
    status,
    ...(counterpartHash ? { counterpartHash } : {})
  }
}

/**
 * Builds the wallet's MANA transfer feed from the decoded L1 + L2 `Transfer` logs.
 *
 * - One row per swap, anchored on the L1 deposit; the correlated L2 mint is suppressed from the feed
 *   and exposed as `counterpartHash`. A deposit without a credit is `bridging`.
 * - An orphan L2 mint (a deposit made by a third party, or a swap from another wallet) becomes its
 *   own `swap` row so bridge-credited MANA is never lost.
 * - Symmetrically for withdraws: one row per L2 burn, the L1 exit correlated as `counterpartHash`.
 * - Plain sends/receiveds pass through. The L2 mint (from 0x0) is NEVER shown as a `received`.
 */
export function buildManaTransferFeed(params: {
  ethereumTransfers: DecodedTransfer[]
  polygonTransfers: DecodedTransfer[]
  user: string
  ethereumPredicate: string
}): ManaTransfer[] {
  const { user, ethereumPredicate } = params
  const all = dedupeTransfers([...params.ethereumTransfers, ...params.polygonTransfers])
  const classified = all.map(transfer => ({
    transfer,
    leg: classifyLeg(transfer, user, transfer.network === Network.ETHEREUM ? ethereumPredicate : '')
  }))

  const pick = (leg: Leg) => classified.filter(entry => entry.leg === leg).map(entry => entry.transfer)
  const deposits = pick('deposit')
  const credits = pick('credit')
  const burns = pick('burn')
  const exits = pick('exit')

  const swapMatches = correlateFifo(deposits, credits)
  const withdrawMatches = correlateFifo(burns, exits)
  const consumedCredits = new Set([...swapMatches.values()].map(legKey))
  const consumedExits = new Set([...withdrawMatches.values()].map(legKey))

  const rows: ManaTransfer[] = []

  for (const deposit of deposits) {
    const credit = swapMatches.get(legKey(deposit))
    rows.push(
      toManaTransfer(deposit, ManaTransferType.SWAP, credit ? ManaTransferStatus.CONFIRMED : ManaTransferStatus.BRIDGING, credit?.hash)
    )
  }
  for (const credit of credits) {
    if (!consumedCredits.has(legKey(credit))) {
      rows.push(toManaTransfer(credit, ManaTransferType.SWAP, ManaTransferStatus.CONFIRMED))
    }
  }
  for (const burn of burns) {
    const exit = withdrawMatches.get(legKey(burn))
    rows.push(
      toManaTransfer(burn, ManaTransferType.WITHDRAW, exit ? ManaTransferStatus.CONFIRMED : ManaTransferStatus.BRIDGING, exit?.hash)
    )
  }
  for (const exit of exits) {
    if (!consumedExits.has(legKey(exit))) {
      rows.push(toManaTransfer(exit, ManaTransferType.WITHDRAW, ManaTransferStatus.CONFIRMED))
    }
  }
  for (const send of pick('send')) {
    rows.push(toManaTransfer(send, ManaTransferType.SEND, ManaTransferStatus.CONFIRMED))
  }
  for (const received of pick('received')) {
    rows.push(toManaTransfer(received, ManaTransferType.RECEIVED, ManaTransferStatus.CONFIRMED))
  }

  return rows.sort((a, b) => b.timestamp - a.timestamp)
}
