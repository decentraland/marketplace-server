import { ChainId, Network, TradeAssetType, TradeType } from '@dcl/schemas'

export enum TradeCancellationReason {
  /** The marketplace owner bumped the contract's signature index, invalidating every trade signed against it. */
  CONTRACT_SIGNATURE_INDEX_BUMP = 'contract_signature_index_bump'
}

export type CancelledTradesFilters = {
  signer: string
  reason: TradeCancellationReason
  first: number
  skip: number
}

export type CancelledTrade = {
  id: string
  type: TradeType
  network: Network
  chainId: ChainId
  /** The marketplace the trade was signed against. */
  contract: string
  reason: TradeCancellationReason
  createdAt: number
  expiresAt: number
  /** Block time of the event that cancelled the trade. */
  cancelledAt: number
  /** What was listed, or bid on. */
  asset: {
    contractAddress: string
    tokenId: string | null
    itemId: string | null
    name: string | null
    image: string | null
  }
  /** What the trade asked for, or offered. */
  price: { assetType: TradeAssetType; amount: string } | null
}

export type CancelledTradesPage = {
  data: CancelledTrade[]
  total: number
}

export type DBCancelledTrade = {
  id: string | null
  type: TradeType
  network: Network
  chain_id: number
  contract: string
  created_at: Date
  expires_at: Date
  cancelled_at: string
  asset_contract: string
  token_id: string | null
  item_id: string | null
  name: string | null
  image: string | null
  price_asset_type: TradeAssetType | null
  price_amount: string | null
  total: string
}

export type ICancelledTradesComponent = {
  /**
   * The signer's trades cancelled for the given reason that they still have to re-create: unexpired, not
   * re-created on a marketplace the reason didn't reach, and whose asset can still be listed or bid on.
   *
   * @param filters - The signer, the reason and the page.
   * @returns A page of cancelled trades, newest first, and how many there are in total.
   */
  getCancelledTrades(filters: CancelledTradesFilters): Promise<CancelledTradesPage>
}
