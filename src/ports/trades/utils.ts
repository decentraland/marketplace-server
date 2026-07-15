import { SQLStatement } from 'sql-template-strings'
import { IPgComponent } from '@dcl/pg-component'
import {
  ERC20TradeAsset,
  Trade,
  TradeAssetType,
  TradeCreation,
  TradeType,
  TradeAsset,
  ERC721TradeAsset,
  CollectionItemTradeAsset,
  USDPeggedManaTradeAsset,
  ListingStatus,
  Event,
  ChainId,
  Network
} from '@dcl/schemas'
import { fromTradeAndAssetsToEventNotification } from '../../adapters/trades/trades'
import { getMarketplaceContracts } from '../../logic/contracts'
import { isEstateFingerprintValid } from '../../logic/trades/utils'
import { getBidsQuery } from '../bids/queries'
import { getItemByItemIdQuery } from '../items/queries'
import { DBItem } from '../items/types'
import { getNftByTokenIdQuery, getNFTsQuery } from '../nfts/queries'
import { DBNFT } from '../nfts/types'
import {
  DuplicatedBidError,
  DuplicateItemOrderError,
  DuplicateNFTOrderError,
  EstateContractNotFoundForChainId,
  InvalidTradeStructureError
} from './errors'
import { getOpenItemOrderExistsQuery } from './queries'
import { TradeEvent } from './types'

// Minimal client surface shared by the pg pool component (IPgComponent) and a transaction's PoolClient,
// so the duplicate-order check can run both as a best-effort pre-check and inside the transaction.
type ItemOrderQueryClient = {
  query: (sql: SQLStatement) => Promise<{ rowCount: number | null }>
}

/**
 * Throws DuplicateItemOrderError when an open `public_item_order` already exists for the given item.
 *
 * Reads the live trades tables (see getOpenItemOrderExistsQuery), so a just-created listing is detected
 * immediately. Pass the pool for the best-effort pre-check, or a transaction client (holding the item
 * advisory lock) for the authoritative check that closes the check-then-insert race.
 *
 * @throws DuplicateItemOrderError when an open order already exists for the item.
 */
export async function assertNoOpenItemOrder(
  client: ItemOrderQueryClient,
  filters: { contractAddress: string; itemId: string; network: Network }
): Promise<void> {
  const existingOrder = await client.query(getOpenItemOrderExistsQuery(filters))
  if ((existingOrder.rowCount ?? 0) > 0) {
    throw new DuplicateItemOrderError()
  }
}

export function isERC20TradeAsset(asset: TradeAsset): asset is ERC20TradeAsset {
  return asset.assetType === TradeAssetType.ERC20
}

export function isERC721TradeAsset(asset: TradeAsset): asset is ERC721TradeAsset {
  return asset.assetType === TradeAssetType.ERC721
}

export function isCollectionItemTradeAsset(asset: TradeAsset): asset is CollectionItemTradeAsset {
  return asset.assetType === TradeAssetType.COLLECTION_ITEM
}

export function isUSDPeggedManaTradeAsset(asset: TradeAsset): asset is USDPeggedManaTradeAsset {
  return asset.assetType === TradeAssetType.USD_PEGGED_MANA
}

// The price side of a listing/bid can be paid in MANA (ERC20) or as a USD-pegged amount settled in MANA at execution.
export function isPriceTradeAsset(asset: TradeAsset): asset is ERC20TradeAsset | USDPeggedManaTradeAsset {
  return isERC20TradeAsset(asset) || isUSDPeggedManaTradeAsset(asset)
}

function isBytesEmpty(bytes: string): boolean {
  return bytes === '0x' || bytes === ''
}

export function isEstateChain(chainId: ChainId): boolean {
  return chainId !== ChainId.MATIC_AMOY && chainId !== ChainId.MATIC_MAINNET
}

export async function isValidEstateTrade(trade: TradeCreation): Promise<boolean> {
  const contracts = getMarketplaceContracts(trade.chainId)
  const estateContract = contracts.find(contract => contract.name === 'Estates')
  if (!estateContract) {
    throw new EstateContractNotFoundForChainId(trade.chainId)
  }

  const assets = [...trade.sent, ...trade.received]
  // Checks trades one by one to prevent unnecessary checks. This should be changed when implementing bundles or the cart system.
  for (const asset of assets) {
    // Only check if the asset is an estate
    if (asset.contractAddress.toLowerCase() === estateContract.address.toLowerCase()) {
      return (
        !isBytesEmpty(asset.extra) &&
        (await isEstateFingerprintValid(estateContract.address, (asset as ERC721TradeAsset)?.tokenId, trade.chainId, asset.extra))
      )
    }
  }

  return true
}

export async function validateTradeByType(trade: TradeCreation, client: IPgComponent): Promise<boolean> {
  const { sent, received, type } = trade

  try {
    if (type === TradeType.BID) {
      // validate bid structure
      const receivesERC721OrItemAsset =
        received.length === 1 && (isERC721TradeAsset(received[0]) || isCollectionItemTradeAsset(received[0]))
      const sendsPriceAsset = sent.length === 1 && isPriceTradeAsset(sent[0])

      if (!receivesERC721OrItemAsset || !sendsPriceAsset) {
        throw new InvalidTradeStructureError(type)
      }

      const duplicateBid = await client.query(
        getBidsQuery({
          bidder: trade.signer,
          network: trade.network,
          contractAddress: trade.received[0].contractAddress,
          ...('tokenId' in trade.received[0] ? { tokenId: trade.received[0].tokenId } : {}),
          ...('itemId' in trade.received[0] ? { itemId: trade.received[0].itemId } : {}),
          status: ListingStatus.OPEN
        })
      )
      if (duplicateBid.rowCount > 0) {
        throw new DuplicatedBidError()
      }
    }

    if (trade.type === TradeType.PUBLIC_NFT_ORDER) {
      const sendsERC721Asset = sent.length === 1 && isERC721TradeAsset(sent[0])
      const receivesPriceAsset = received.length === 1 && isPriceTradeAsset(received[0])

      if (!sendsERC721Asset || !receivesPriceAsset) {
        throw new InvalidTradeStructureError(trade.type)
      }

      const query = getNFTsQuery({
        contractAddresses: [trade.sent[0].contractAddress],
        tokenId: (trade.sent[0] as ERC721TradeAsset).tokenId,
        network: trade.network,
        isOnSale: true
      })
      const duplicateOrder = await client.query(query)

      if (duplicateOrder.rowCount > 0) {
        throw new DuplicateNFTOrderError()
      }
    }

    if (trade.type === TradeType.PUBLIC_ITEM_ORDER) {
      const sendsCollectionItemAsset = sent.length === 1 && isCollectionItemTradeAsset(sent[0])
      const receivesPriceAsset = received.length === 1 && isPriceTradeAsset(received[0])

      if (!sendsCollectionItemAsset || !receivesPriceAsset) {
        throw new InvalidTradeStructureError(trade.type)
      }

      // Best-effort pre-check against the live trades tables (not the mv_trades materialized view, which
      // lags behind until refreshed) so a just-created listing is detected immediately. The transactional
      // advisory-lock re-check in the trades component closes the remaining check-then-insert race.
      await assertNoOpenItemOrder(client, {
        contractAddress: trade.sent[0].contractAddress,
        itemId: (trade.sent[0] as CollectionItemTradeAsset).itemId,
        network: trade.network
      })
    }

    return true
  } catch (e) {
    console.error(e)
    throw e
  }
}

export async function getNotificationEventForTrade(
  trade: Trade,
  pg: IPgComponent,
  tradeEvent: TradeEvent,
  caller: string
): Promise<Event | null> {
  const assets: (DBNFT | DBItem | undefined)[] = await Promise.all(
    [...trade.sent, ...trade.received].map((asset: TradeAsset) => {
      if (asset.assetType === TradeAssetType.ERC721) {
        return pg.query<DBNFT>(getNftByTokenIdQuery(asset.contractAddress, asset.tokenId, trade.network)).then(result => result.rows[0])
      } else if (asset.assetType === TradeAssetType.COLLECTION_ITEM) {
        return pg.query<DBItem>(getItemByItemIdQuery(asset.contractAddress, asset.itemId)).then(result => result.rows[0])
      } else {
        return Promise.resolve(undefined)
      }
    })
  )

  return fromTradeAndAssetsToEventNotification(trade, assets, tradeEvent, caller)
}
