import { Trade, TradeAssetType, TradeCreation } from '@dcl/schemas'

export type ITradesComponent = {
  getTrades(): Promise<{ data: DBTrade[]; count: number }>
  addTrade(body: TradeCreation, signer: string): Promise<Trade>
}

export type DBTrade = {
  chain_id: number
  checks: Record<string, any>
  created_at: Date
  effective_since: Date
  expires_at: Date
  id: string
  network: string
  signature: string
  signer: string
  type: 'bid' | 'public_order'
}

export type DBTradeAsset = {
  asset_type: number // (1: ERC20, 2: ERC721, 3: COLLECTION ITEM)
  contract_address: string
  beneficiary?: string
  created_at: Date
  direction: 'sent' | 'received'
  extra: string
  id: string
  trade_id: string
}

export type DBTradeAssetValue = { token_id: string } | { item_id: string } | { amount: number }

export type DBTradeAssetWithValue =
  | (DBTradeAsset & { asset_type: TradeAssetType.ERC20; amount: number })
  | (DBTradeAsset & { asset_type: TradeAssetType.ERC721; token_id: string })
  | (DBTradeAsset & { asset_type: TradeAssetType.COLLECTION_ITEM; item_id: string })

export const TradeCreationAssetSchema = {
  type: 'object',
  properties: {
    assetType: {
      type: 'number',
      enum: [1, 2, 3, 4]
    },
    contractAddress: {
      type: 'string',
      pattern: '^0x[0-9a-fA-F]{40}$'
    },
    value: {
      type: 'string'
    },
    extra: {
      type: 'string'
    }
  },
  required: ['assetType', 'contractAddress', 'value', 'extra'],
  additionalProperties: false
}

export const TradeCreationSchema = {
  type: 'object',
  properties: {
    netword: { type: 'string' },
    chainId: { type: 'number' },
    type: { type: 'string', enum: ['bid'] }, // for now we only support bids
    signature: { type: 'string' },
    checks: {
      type: 'object',
      properties: {
        uses: {
          type: 'number',
          minimum: 1
        },
        expiration: {
          type: 'number',
          minimum: 0
        },
        effective: {
          type: 'number',
          minimum: 0
        },
        salt: {
          type: 'string'
        },
        contractSignatureIndex: {
          type: 'number',
          minimum: 0
        },
        signerSignatureIndex: {
          type: 'number',
          minimum: 0
        },
        allowedRoot: {
          type: 'string'
        },
        externalChecks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              contractAddress: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
              selector: { type: 'string' },
              value: {
                type: 'number'
              },
              required: {
                type: 'boolean'
              }
            },
            required: ['contractAddress', 'selector', 'value', 'required'],
            additionalProperties: false
          }
        }
      },
      required: ['uses', 'expiration', 'effective', 'salt', 'contractSignatureIndex', 'signerSignatureIndex'],
      additionalProperties: false
    },
    sent: { type: 'array', items: { ...TradeCreationAssetSchema } },
    received: {
      type: 'array',
      items: {
        ...TradeCreationAssetSchema,
        properties: {
          ...TradeCreationAssetSchema.properties,
          beneficiary: {
            type: 'string',
            pattern: '^0x[0-9a-fA-F]{40}$'
          }
        },
        required: [...TradeCreationAssetSchema.required, 'beneficiary']
      }
    }
  },
  required: ['signature', 'checks', 'sent', 'received', 'type', 'network', 'chainId'],
  additionalProperties: false
}
