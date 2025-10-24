import { JSONSchema } from '@dcl/schemas'
import { NFTType, WidgetOptions } from './types'

export const WidgetOptionsSchema: JSONSchema<Partial<WidgetOptions>> = {
  type: 'object',
  properties: {
    fiatAmount: { type: 'number', nullable: true },
    fiatCurrency: { type: 'string', nullable: true },
    defaultNetwork: { type: 'string', nullable: true },
    walletAddress: { type: 'string', nullable: true },
    estimatedGasLimit: { type: 'number', nullable: true },
    contractId: { type: 'string', nullable: true },
    email: { type: 'string', nullable: true },
    redirectURL: { type: 'string', nullable: true },
    contractAddress: { type: 'string', nullable: true },
    tradeType: { type: 'string', nullable: true },
    productsAvailed: { type: 'string', nullable: true },
    isNFT: { type: 'boolean', nullable: true },
    nftData: {
      type: 'array',
      nullable: true,
      items: {
        type: 'object',
        properties: {
          imageURL: { type: 'string' },
          nftName: { type: 'string' },
          collectionAddress: { type: 'string' },
          tokenID: { type: 'array', items: { type: 'string' } },
          price: { type: 'array', items: { type: 'number' } },
          quantity: { type: 'number' },
          nftType: { type: 'string', enum: [NFTType.ERC721, NFTType.ERC1155] }
        },
        required: ['imageURL', 'nftName', 'collectionAddress', 'tokenID', 'price', 'quantity', 'nftType']
      }
    },
    calldata: { type: 'string', nullable: true }
  },
  required: [],
  additionalProperties: false
}
