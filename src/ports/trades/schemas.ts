import { TradeAssetType } from '@dcl/schemas'

export const TradeCreationAssetSchema = {
  type: 'object',
  properties: {
    assetType: {
      type: 'number',
      enum: [TradeAssetType.ERC20, TradeAssetType.ERC721, TradeAssetType.COLLECTION_ITEM]
    },
    contractAddress: {
      type: 'string',
      pattern: '^0x[0-9a-fA-F]{40}$'
    },
    amount: {
      type: 'string',
      pattern: '^(0|[1-9][0-9]*)$'
    },
    itemId: {
      type: 'string'
    },
    tokenId: {
      type: 'string'
    },
    extra: {
      type: 'string'
    }
  },
  anyOf: [
    {
      properties: {
        assetType: { const: TradeAssetType.ERC20 }
      },
      required: ['amount']
    },
    {
      properties: {
        assetType: { const: TradeAssetType.ERC721 }
      },
      required: ['tokenId']
    },
    {
      properties: {
        assetType: { const: TradeAssetType.COLLECTION_ITEM }
      },
      required: ['itemId']
    }
  ],
  required: ['contractAddress', 'extra', 'assetType'],
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
