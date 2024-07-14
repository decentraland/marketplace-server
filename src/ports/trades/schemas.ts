import { JSONSchema, TradeAssetType, TradeAsset, TradeCreation, TradeType, BaseTradeAsset, TradeAssetWithBeneficiary } from '@dcl/schemas'

export const BaseTradeAssetSchema: JSONSchema<BaseTradeAsset> = {
  type: 'object',
  properties: {
    assetType: {
      type: 'integer',
      enum: [TradeAssetType.ERC20, TradeAssetType.ERC721, TradeAssetType.COLLECTION_ITEM]
    },
    contractAddress: {
      type: 'string',
      pattern: '^0x[0-9a-fA-F]{40}$'
    },
    extra: {
      type: 'string'
    }
  },
  required: ['assetType', 'contractAddress', 'extra']
}

export const TradeCreationAssetSchema: JSONSchema<TradeAsset> = {
  type: 'object',
  oneOf: [
    {
      properties: {
        ...BaseTradeAssetSchema.properties,
        assetType: { const: TradeAssetType.ERC20 },
        amount: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' }
      },
      required: [...BaseTradeAssetSchema.required, 'amount']
    },
    {
      properties: {
        ...BaseTradeAssetSchema.properties,
        assetType: { const: TradeAssetType.ERC721 },
        tokenId: { type: 'string' }
      },
      required: [...BaseTradeAssetSchema.required, 'tokenId']
    },
    {
      properties: {
        ...BaseTradeAssetSchema.properties,
        assetType: { const: TradeAssetType.COLLECTION_ITEM },
        itemId: { type: 'string' }
      },
      required: [...BaseTradeAssetSchema.required, 'itemId']
    }
  ],
  required: []
}

export const TradeCreationAssetSchemaWithBeneficiary: JSONSchema<TradeAssetWithBeneficiary> = {
  type: 'object',
  oneOf:
    TradeCreationAssetSchema.oneOf?.map(schema => ({
      ...schema,
      properties: {
        ...schema.properties,
        beneficiary: {
          type: 'string',
          pattern: '^0x[0-9a-fA-F]{40}$'
        }
      },
      required: [...schema.required, 'beneficiary']
    })) ?? [],
  required: []
}

export const TradeCreationSchema: JSONSchema<TradeCreation> = {
  type: 'object',
  properties: {
    signer: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    network: { type: 'string' },
    chainId: { type: 'number' },
    type: { type: 'string', enum: [TradeType.BID] }, // for now we only support bids
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
        allowedProof: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string'
          }
        },
        externalChecks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              contractAddress: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
              selector: { type: 'string' },
              value: {
                type: 'string'
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
    sent: { type: 'array', minItems: 1, items: TradeCreationAssetSchema },
    received: {
      type: 'array',
      minItems: 1,
      items: TradeCreationAssetSchemaWithBeneficiary
    }
  },
  required: ['signature', 'checks', 'sent', 'received', 'type', 'network', 'chainId'],
  additionalProperties: false
}
