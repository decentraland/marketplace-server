import { ethers } from 'ethers'
import { ChainId } from '@dcl/schemas'
import { getEthereumChainId } from '../../logic/chainIds'
import { AppComponents } from '../../types'
import { BlockTooRecentError, HistoricalBusyError } from './errors'
import { getEstateSizesAtBlockQuery, getOwnersAtBlockQuery, getRentalsAtBlockQuery, NftTarget } from './queries'
import {
  EstateSizeDBRow,
  HistoricalEstate,
  HistoricalEstatesFilters,
  HistoricalNft,
  HistoricalNftsFilters,
  HistoricalRentalAsset,
  HistoricalRentalAssetsFilters,
  IHistoricalComponent,
  OwnerAtBlockDBRow,
  RentalAtBlockDBRow
} from './types'

/** Holdings are read only at blocks at least this old, so that the indexers surely hold them. */
export const MIN_BLOCK_AGE_SECONDS = 180

/**
 * The rows kept across the cached results. A proposal is voted on for days at the same block and its
 * voters are asked about in batches, so the holdings at a block are read once and kept; the least
 * recently used are dropped past this.
 */
export const MAX_CACHED_ROWS = 500000

/** And at most this many results, however small. */
export const MAX_CACHED_RESULTS = 256

/**
 * And none for longer than this. Whether a squid holds a block is told only by the block's age, so a
 * result read while a squid lagged is incomplete: it is read again soon, not kept for the whole vote.
 */
export const MAX_RESULT_AGE_MS = 15 * 60 * 1000

/** Block timestamps are a few bytes each; keep enough for every block being voted on. */
const CACHED_TIMESTAMPS = 1000

/** Reading the holdings at a block scans the transfers: only this many run at once... */
export const MAX_RUNNING_READS = 2

/** ...and only this many wait for their turn; past that, requests are turned away until it clears. */
export const MAX_WAITING_READS = 16

const RPC_TIMEOUT_MS = 10000

/** The Ethereum RPC of the environment, for block timestamps. */
export function createEthereumBlockTimestamps(rpcUrl?: string): (block: number) => Promise<number | undefined> {
  const chainId = getEthereumChainId()
  const request = new ethers.FetchRequest(
    rpcUrl || (chainId === ChainId.ETHEREUM_MAINNET ? 'https://rpc.decentraland.org/mainnet' : 'https://rpc.decentraland.org/sepolia')
  )
  request.timeout = RPC_TIMEOUT_MS
  // The network is known: without it, ethers would keep detecting it whenever the RPC is down.
  const provider = new ethers.JsonRpcProvider(request, chainId, { staticNetwork: true })
  return async block => (await provider.getBlock(block))?.timestamp
}

/** Orders NFTs and assets the way the subgraphs order their ids, `<contractAddress>-<tokenId>` as a string. */
const byId = (a: { contractAddress: string; tokenId: string }, b: { contractAddress: string; tokenId: string }) => {
  const x = `${a.contractAddress}-${a.tokenId}`
  const y = `${b.contractAddress}-${b.tokenId}`
  return x < y ? -1 : x > y ? 1 : 0
}

/** The distinct values, sorted, or undefined for none: the same filter always gets the same key. */
const normalized = (values: string[] | undefined) => (values?.length ? Array.from(new Set(values)).sort() : undefined)

const lowercased = (addresses: string[] | undefined) => addresses?.map(address => address.toLowerCase())

/** A block too recent is asked about again only after this, whoever asks. */
const TOO_RECENT_KEPT_MS = 10000

type Entry = { value: Promise<unknown>; rows: number; settled: boolean; readAt: number }

export function createHistoricalComponent(options: {
  dappsDatabase: Pick<AppComponents, 'dappsDatabase'>['dappsDatabase']
  /** The timestamp of an Ethereum block, or undefined if the chain has not reached it. */
  getBlockTimestamp: (block: number) => Promise<number | undefined>
  now?: () => number
  maxCachedRows?: number
}): IHistoricalComponent {
  const { dappsDatabase, getBlockTimestamp } = options
  const now = options.now ?? Date.now
  const maxCachedRows = options.maxCachedRows ?? MAX_CACHED_ROWS

  const results = new Map<string, Entry>()
  let cachedRows = 0
  const timestamps = new Map<string, Promise<number>>()

  let running = 0
  const waiting: (() => void)[] = []

  /**
   * Runs a database read once one of the few slots is free; turns it away if too many are waiting. A
   * read that ends hands its slot to the next one waiting, so none can take it in between.
   */
  async function read<T>(query: () => Promise<T>): Promise<T> {
    if (running >= MAX_RUNNING_READS) {
      if (waiting.length >= MAX_WAITING_READS) throw new HistoricalBusyError()
      await new Promise<void>(resolve => waiting.push(resolve))
    } else {
      running++
    }
    try {
      return await query()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else running--
    }
  }

  /**
   * One computation per key, shared by concurrent requests and kept for the next ones; a hit makes it
   * the most recently used. A failure is not kept. Database reads end within the pool's statement
   * timeout, so nothing pending stays forever.
   */
  function cached<T>(key: string, load: () => Promise<{ value: T; rows: number }>): Promise<T> {
    const hit = results.get(key)
    if (hit && !(hit.settled && now() - hit.readAt > MAX_RESULT_AGE_MS)) {
      results.delete(key)
      results.set(key, hit)
      return hit.value as Promise<T>
    }
    if (hit) {
      results.delete(key)
      cachedRows -= hit.rows
    }
    const entry: Entry = { value: Promise.resolve(), rows: 0, settled: false, readAt: now() }
    const loaded = load()
    entry.value = loaded.then(({ value }) => value)
    results.set(key, entry)
    loaded.then(
      ({ rows }) => {
        if (results.get(key) !== entry) return
        // A result larger than everything kept is answered but not kept.
        if (rows > maxCachedRows) {
          results.delete(key)
          return
        }
        entry.settled = true
        entry.rows = Math.max(rows, 1)
        cachedRows += entry.rows
        // Drop the least recently used until the rest fits, keeping the one just read and those still loading.
        for (const [oldest, oldestEntry] of results) {
          if (cachedRows <= maxCachedRows && results.size <= MAX_CACHED_RESULTS) break
          if (oldest === key || !oldestEntry.settled) continue
          results.delete(oldest)
          cachedRows -= oldestEntry.rows
        }
      },
      () => {
        if (results.get(key) === entry) results.delete(key)
      }
    )
    return entry.value as Promise<T>
  }

  /** The block's timestamp, once the block is old enough to read holdings at. */
  function blockTimestamp(block: number): Promise<number> {
    const key = String(block)
    let timestamp = timestamps.get(key)
    if (!timestamp) {
      timestamp = getBlockTimestamp(block).then(found => {
        if (found === undefined || now() / 1000 - found < MIN_BLOCK_AGE_SECONDS) throw new BlockTooRecentError(block)
        return found
      })
      const pending = timestamp
      // A failure is forgotten at once, a block too recent a little later: the chain moves on.
      pending.catch(error => {
        const forget = () => timestamps.get(key) === pending && timestamps.delete(key)
        if (error instanceof BlockTooRecentError) setTimeout(forget, TOO_RECENT_KEPT_MS).unref()
        else forget()
      })
      timestamps.set(key, pending)
      if (timestamps.size > CACHED_TIMESTAMPS) timestamps.delete(timestamps.keys().next().value as string)
    }
    return timestamp
  }

  function ownersAt(block: number, target: NftTarget): Promise<OwnerAtBlockDBRow[]> {
    return cached(JSON.stringify({ owners: block, ...target }), async () => {
      const { rows } = await read(() => dappsDatabase.query<OwnerAtBlockDBRow>(getOwnersAtBlockQuery(block, target)))
      return { value: rows, rows: rows.length }
    })
  }

  function estateSizesAt(block: number): Promise<Map<string, number>> {
    return cached(`estate-sizes:${block}`, async () => {
      const { rows } = await read(() => dappsDatabase.query<EstateSizeDBRow>(getEstateSizesAtBlockQuery(block)))
      return { value: new Map(rows.map(row => [row.estate_token_id, Number(row.size)])), rows: rows.length }
    })
  }

  function rentalsAt(block: number): Promise<RentalAtBlockDBRow[]> {
    return cached(`rentals:${block}`, async () => {
      const { rows } = await read(() => dappsDatabase.query<RentalAtBlockDBRow>(getRentalsAtBlockQuery(block)))
      return { value: rows, rows: rows.length }
    })
  }

  async function getNfts(filters: HistoricalNftsFilters): Promise<HistoricalNft[]> {
    await blockTimestamp(filters.block)
    const owners = new Set(filters.owners.map(owner => owner.toLowerCase()))
    const idGt = filters.idGt?.toLowerCase()
    const rows = (
      await ownersAt(filters.block, {
        category: filters.category,
        contractAddresses: normalized(lowercased(filters.contractAddresses)),
        itemTypes: normalized(filters.itemTypes)
      })
    ).filter(row => owners.has(row.owner))
    const sizes = rows.some(row => row.category === 'estate') ? await estateSizesAt(filters.block) : undefined

    return rows
      .map(row => ({
        contractAddress: row.contract_address,
        tokenId: row.token_id,
        category: row.category,
        owner: row.owner,
        itemType: row.item_type,
        searchWearableRarity: row.search_wearable_rarity,
        // An estate with no parcel added by the block has none.
        searchEstateSize: row.category === 'estate' ? sizes?.get(row.token_id) ?? 0 : null
      }))
      .filter(nft => filters.estateSizeGt === undefined || (nft.searchEstateSize !== null && nft.searchEstateSize > filters.estateSizeGt))
      .filter(nft => idGt === undefined || `${nft.contractAddress}-${nft.tokenId}` > idGt)
      .sort(byId)
      .slice(filters.skip, filters.skip + filters.first)
  }

  async function getEstates(filters: HistoricalEstatesFilters): Promise<HistoricalEstate[]> {
    await blockTimestamp(filters.block)
    const sizes = await estateSizesAt(filters.block)
    return Array.from(new Set(filters.tokenIds))
      .flatMap(tokenId => {
        const size = sizes.get(tokenId)
        return size === undefined ? [] : [{ tokenId, size }]
      })
      .filter(estate => filters.sizeGt === undefined || estate.size > filters.sizeGt)
      .sort((a, b) => (a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0))
      .slice(filters.skip, filters.skip + filters.first)
  }

  async function getRentalAssets(filters: HistoricalRentalAssetsFilters): Promise<HistoricalRentalAsset[]> {
    const timestamp = await blockTimestamp(filters.block)
    const lessors = new Set(filters.lessors.map(lessor => lessor.toLowerCase()))
    const contracts = filters.contractAddresses?.length ? new Set(lowercased(filters.contractAddresses)) : undefined
    return (await rentalsAt(filters.block))
      .map(row => {
        const isClaimed = row.claimed_at !== null && Number(row.claimed_at) <= timestamp
        return { contractAddress: row.contract_address, tokenId: row.token_id, lessor: isClaimed ? null : row.lessor, isClaimed }
      })
      .filter(asset => asset.lessor !== null && lessors.has(asset.lessor.toLowerCase()))
      .filter(asset => !contracts || contracts.has(asset.contractAddress.toLowerCase()))
      .filter(asset => filters.isClaimed === undefined || asset.isClaimed === filters.isClaimed)
      .sort(byId)
      .slice(filters.skip, filters.skip + filters.first)
  }

  return { getNfts, getEstates, getRentalAssets }
}
