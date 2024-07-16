import { Trade, TradeAssetType, TradeCreation, TradeChecks, TradeAssetDirection, TradeType } from '@dcl/schemas'

export type ITradesComponent = {
  getTrades(): Promise<{ data: DBTrade[]; count: number }>
  addTrade(body: TradeCreation, signer: string): Promise<Trade>
  getTrade(id: string): Promise<Trade>
}

export type DBTrade = {
  chain_id: number
  checks: TradeChecks
  created_at: Date
  effective_since: Date
  expires_at: Date
  id: string
  network: string
  signature: string
  signer: string
  type: TradeType
}

export type DBTradeAsset = {
  asset_type: number // (1: ERC20, 2: ERC721, 3: COLLECTION ITEM)
  contract_address: string
  beneficiary?: string
  created_at: Date
  direction: TradeAssetDirection
  extra: string
  id: string
  trade_id: string
}

export type DBTradeAssetValue = { token_id: string } | { item_id: string } | { amount: string }

export type DBTradeAssetWithERC20Value = DBTradeAsset & { asset_type: TradeAssetType.ERC20; amount: string }
export type DBTradeAssetWithERC721Value = DBTradeAsset & { asset_type: TradeAssetType.ERC721; token_id: string }
export type DBTradeAssetWithCollectionItemValue = DBTradeAsset & { asset_type: TradeAssetType.COLLECTION_ITEM; item_id: string }

export type DBTradeAssetWithValue = DBTradeAssetWithERC20Value | DBTradeAssetWithERC721Value | DBTradeAssetWithCollectionItemValue

export type DBTradeWithAssets = {
  count: number
  chain_id: number
  checks: TradeChecks
  created_at: Date
  effective_since: Date
  expires_at: Date
  id: string
  network: string
  signature: string
  signer: string
  type: TradeType
  assets: DBTradeAssetWithValue[]
}
