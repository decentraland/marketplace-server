import { Trade } from '@dcl/schemas'

export type ITradesComponent = {
  getTrades(): Promise<{ data: DBTrade[]; count: number }>
  addTrade(body: Trade, signer: string): Promise<DBTrade>
}

export type DBTrade = {
  chainId: number
  checks: Record<string, any>
  createdAt: Date
  effectiveSince: Date
  expiresAt: Date
  id: string
  network: string
  signature: string
  signer: string
  type: 'bid' | 'public_order'
}

export type DBTradeAsset = {
  asset_type: number // (1: ERC20, 2: ERC721, 3: COLLECTION ITEM)
  beneficiary?: string
  contract_address: string
  created_at: Date
  direction: 'sent' | 'received'
  extra: string
  id: string
  trade_id: string
  value: number
}

export const TradeCreationAssetSchema = {
  type: 'object',
  properties: {
    assetType: {
      type: 'string',
      enum: [1, 2, 3, 4]
    },
    contractAddress: {
      type: 'string',
      pattern: '^0x[0-9a-fA-F]{40}$'
    },
    value: {
      type: 'number',
      minimum: 0
    },
    extra: {
      type: 'string'
    },
    beneficiary: {
      type: 'string',
      pattern: '^0x[0-9a-fA-F]{40}$'
    }
  },
  required: ['assetType', 'contractAddress', 'value', 'extra', 'beneficiary'],
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
          type: 'number',
          minimum: 0
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
    received: { type: 'array', items: { ...TradeCreationAssetSchema } }
  },
  required: ['signature', 'checks', 'sent', 'received', 'type', 'network', 'chainId'],
  additionalProperties: false
}
