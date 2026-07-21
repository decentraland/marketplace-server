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
  ChainId
} from '@dcl/schemas'
import { ContractName, getContract } from 'decentraland-transactions'
import { fromTradeAndAssetsToEventNotification } from '../../adapters/trades/trades'
import { getMarketplaceContracts } from '../../logic/contracts'
import { isEstateFingerprintValid } from '../../logic/trades/utils'
import { getBidsQuery } from '../bids/queries'
import { getItemByItemIdQuery } from '../items/queries'
import { DBItem } from '../items/types'
import { getNftByTokenIdQuery } from '../nfts/queries'
import { DBNFT } from '../nfts/types'
import {
  DuplicatedBidError,
  DuplicateItemOrderError,
  DuplicateNFTOrderError,
  EstateContractNotFoundForChainId,
  InvalidTradePriceAssetError,
  InvalidTradeStructureError
} from './errors'
import { getOpenItemOrderQuery, getOpenNFTOrderQuery } from './queries'
import { TradeEvent } from './types'

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

// The price of a trade must settle in MANA. A USD_PEGGED_MANA asset is always resolved to MANA at
// execution time by the contract, so its contract address is irrelevant. A plain ERC20 asset, however,
// is transferred verbatim from the signed contract address, so it must be restricted to the chain's
// official MANA token. Without this check the price could be denominated in an arbitrary ERC20 that
// the marketplace UI still presents to the seller as MANA.
export function isValidPriceAsset(asset: TradeAsset, chainId: ChainId): boolean {
  if (isUSDPeggedManaTradeAsset(asset)) {
    return true
  }

  if (isERC20TradeAsset(asset)) {
    let manaAddress: string
    try {
      manaAddress = getContract(ContractName.MANAToken, chainId).address.toLowerCase()
    } catch {
      // An unsupported chain has no MANA token, so the price asset cannot be valid.
      return false
    }
    return asset.contractAddress.toLowerCase() === manaAddress
  }

  return false
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

      // The bid price must settle in MANA, otherwise the seller could be paid in an arbitrary ERC20.
      if (!isValidPriceAsset(sent[0], trade.chainId)) {
        throw new InvalidTradePriceAssetError()
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

      // The order price must settle in MANA, otherwise the seller could be paid in an arbitrary ERC20.
      if (!isValidPriceAsset(received[0], trade.chainId)) {
        throw new InvalidTradePriceAssetError()
      }

      const duplicateOrder = await client.query(
        getOpenNFTOrderQuery(trade.sent[0].contractAddress, (trade.sent[0] as ERC721TradeAsset).tokenId)
      )

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

      // The order price must settle in MANA, otherwise the seller could be paid in an arbitrary ERC20.
      if (!isValidPriceAsset(received[0], trade.chainId)) {
        throw new InvalidTradePriceAssetError()
      }

      const duplicateOrder = await client.query(
        getOpenItemOrderQuery(trade.sent[0].contractAddress, (trade.sent[0] as CollectionItemTradeAsset).itemId)
      )

      if (duplicateOrder.rowCount > 0) {
        throw new DuplicateItemOrderError()
      }
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
