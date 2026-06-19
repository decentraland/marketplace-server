import { JsonRpcProvider } from 'ethers'
import { Network } from '@dcl/schemas'
import { isAddress } from '../../logic/address'
import { getEthereumChainId, getPolygonChainId } from '../../logic/chainIds'
import { AppComponents } from '../../types'
import {
  addressToTopic,
  buildManaTransferFeed,
  decodeTransferLog,
  getBridgeAddresses,
  getRpcUrlByChainId,
  TRANSFER_EVENT_TOPIC
} from './logic'
import { DecodedTransfer, IManaTransfersComponent, ManaTransfer, RawTransferLog } from './types'

// MANA transfer logs are immutable once mined, so a short TTL is enough; it only bounds how long a
// freshly-credited bridge swap stays `bridging` before the next fetch flips it to `confirmed`.
const CACHE_TTL_IN_SECONDS = 120

// The DCL RPC (Alchemy) returns at most 10k logs for an arbitrary block range. Hitting the cap means
// the response is truncated — see fetchTransferLogs.
const RPC_LOG_RESULT_CAP = 10_000

/**
 * Creates the MANA Transfers component.
 *
 * Reads a wallet's MANA ERC20 `Transfer` history directly from the DCL RPC via `eth_getLogs`
 * (server-side), classifies sends/receiveds/swaps/withdraws, correlates the two bridge legs, and
 * caches the result. No indexer/database is involved — this is the read path the standalone account
 * dapp never had.
 *
 * @param components Required components: logs, inMemoryCache
 * @returns IManaTransfersComponent implementation
 */
export function createManaTransfersComponent(components: Pick<AppComponents, 'logs' | 'inMemoryCache'>): IManaTransfersComponent {
  const { logs, inMemoryCache } = components
  const logger = logs.getLogger('mana-transfers-component')

  const ethereumChainId = getEthereumChainId()
  const polygonChainId = getPolygonChainId()
  const ethereumAddresses = getBridgeAddresses(ethereumChainId)
  const polygonAddresses = getBridgeAddresses(polygonChainId)

  let ethereumProvider: JsonRpcProvider | undefined
  let polygonProvider: JsonRpcProvider | undefined

  function getProvider(network: Network): JsonRpcProvider {
    if (network === Network.ETHEREUM) {
      ethereumProvider = ethereumProvider ?? new JsonRpcProvider(getRpcUrlByChainId(ethereumChainId))
      return ethereumProvider
    }
    polygonProvider = polygonProvider ?? new JsonRpcProvider(getRpcUrlByChainId(polygonChainId))
    return polygonProvider
  }

  // A raw eth_getLogs call (not ethers' typed getLogs) so the DCL RPC's `blockTimestamp` extension
  // survives — that avoids an eth_getBlock per log to date each transfer.
  async function fetchTransferLogs(network: Network, mana: string, topics: (string | null)[]): Promise<RawTransferLog[]> {
    const provider = getProvider(network)
    const logsResult = (await provider.send('eth_getLogs', [
      {
        address: mana,
        fromBlock: '0x0',
        toBlock: 'latest',
        topics: [TRANSFER_EVENT_TOPIC, ...topics]
      }
    ])) as RawTransferLog[]
    if (!Array.isArray(logsResult)) {
      return []
    }
    // Fail loudly on a truncated response instead of caching a partial feed: a truncated set would
    // silently drop transfers AND corrupt the bridge-leg correlation (kept origins, dropped closings
    // → spurious `bridging`). A wallet with >10k MANA transfers in one direction is the rare case
    // that needs block-range pagination (a follow-up); until then it 500s rather than lying.
    if (logsResult.length >= RPC_LOG_RESULT_CAP) {
      throw new Error('MANA transfer history exceeds the RPC log result cap for this wallet; range pagination required')
    }
    return logsResult
  }

  // Skip non-conforming logs (the topic filter pins a standard Transfer, so this is defensive) — a
  // malformed `data`/`topics` would otherwise abort the whole feed when decoded.
  function isStandardTransferLog(log: RawTransferLog): boolean {
    return !log.removed && Array.isArray(log.topics) && log.topics.length >= 3 && typeof log.data === 'string' && log.data.length > 2
  }

  async function fetchChainTransfers(network: Network, mana: string, userTopic: string): Promise<DecodedTransfer[]> {
    const [sent, received] = await Promise.all([
      fetchTransferLogs(network, mana, [userTopic, null]),
      fetchTransferLogs(network, mana, [null, userTopic])
    ])
    return [...sent, ...received].filter(isStandardTransferLog).map(log => decodeTransferLog(log, network))
  }

  /**
   * Returns the wallet's MANA transfer history across Ethereum and Polygon, newest first.
   *
   * @param address - The wallet address
   * @returns Promise resolving to the transfer feed and its total count
   */
  async function getManaTransfers(address: string): Promise<{ data: ManaTransfer[]; total: number }> {
    if (!isAddress(address)) {
      throw new Error('Invalid address')
    }

    const user = address.toLowerCase()
    const cacheKey = `mana-transfers:${user}`
    const cached = await inMemoryCache.get<{ data: ManaTransfer[]; total: number }>(cacheKey)
    if (cached) {
      return cached
    }

    const userTopic = addressToTopic(user)
    const [ethereumTransfers, polygonTransfers] = await Promise.all([
      fetchChainTransfers(Network.ETHEREUM, ethereumAddresses.mana, userTopic),
      fetchChainTransfers(Network.MATIC, polygonAddresses.mana, userTopic)
    ])

    const data = buildManaTransferFeed({
      ethereumTransfers,
      polygonTransfers,
      user,
      ethereumPredicate: ethereumAddresses.erc20Predicate
    })

    const result = { data, total: data.length }
    await inMemoryCache.set(cacheKey, result, CACHE_TTL_IN_SECONDS)
    logger.debug('Fetched MANA transfers', { address: user, total: data.length })

    return result
  }

  return {
    getManaTransfers
  }
}
