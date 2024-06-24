import { JSONSchema, TradeAsset, TradeChecks } from '@dcl/schemas'

export type ITradesComponent = {
  getTrades(): Promise<{ data: DBTrade[]; count: number }>
  addTrade(body: AddTradeRequestBody, signer: string): Promise<DBTrade>
}

export type DBTrade = {
  signer: string
  id: string
  checks: Record<string, any>
  signature: string
}

export type AddTradeRequestBody = {
  signature: string
  checks: TradeChecks
  sent: TradeAsset[]
  received: TradeAsset[]
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
  required: ['signature', 'checks', 'sent', 'received'],
  additionalProperties: false
}
