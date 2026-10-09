import { JSONSchema, NFTCategory } from '@dcl/schemas'

/** The most addresses or ids one request filters by; a proposal's voters are asked about in batches. */
export const MAX_FILTER_VALUES = 10000

/** The most results one page returns, as on the subgraphs. */
export const MAX_PAGE_SIZE = 1000

/** The item types the marketplace squid knows (its `ItemType` enum). */
const ITEM_TYPES = ['undefined', 'wearable_v1', 'wearable_v2', 'smart_wearable_v1', 'emote_v1']

/** The most contracts a request narrows to: only a handful hold LAND, estates or wearables on Ethereum. */
export const MAX_CONTRACTS = 100

const address = { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' } as const
const addresses = { type: 'array', items: address, maxItems: MAX_FILTER_VALUES } as const
const block = { type: 'integer', minimum: 1, maximum: 2147483647 } as const
const first = { type: 'integer', minimum: 0, maximum: MAX_PAGE_SIZE, nullable: true } as const
const skip = { type: 'integer', minimum: 0, nullable: true } as const

export type HistoricalNftsRequest = {
  block: number
  owners: string[]
  category?: string
  contractAddresses?: string[]
  itemTypes?: string[]
  estateSizeGt?: number
  idGt?: string
  first?: number
  skip?: number
}

export type HistoricalEstatesRequest = {
  block: number
  tokenIds: string[]
  sizeGt?: number
  first?: number
  skip?: number
}

export type HistoricalRentalAssetsRequest = {
  block: number
  lessors: string[]
  contractAddresses?: string[]
  isClaimed?: boolean
  first?: number
  skip?: number
}

export const HistoricalNftsSchema: JSONSchema<HistoricalNftsRequest> = {
  type: 'object',
  properties: {
    block,
    owners: addresses,
    category: {
      type: 'string',
      enum: [NFTCategory.PARCEL, NFTCategory.ESTATE, NFTCategory.WEARABLE, NFTCategory.ENS, NFTCategory.EMOTE],
      nullable: true
    },
    contractAddresses: { ...addresses, maxItems: MAX_CONTRACTS, nullable: true },
    itemTypes: { type: 'array', items: { type: 'string', enum: ITEM_TYPES }, maxItems: ITEM_TYPES.length, nullable: true },
    estateSizeGt: { type: 'integer', nullable: true },
    idGt: { type: 'string', maxLength: 128, nullable: true },
    first,
    skip
  },
  required: ['block', 'owners'],
  additionalProperties: false
}

export const HistoricalEstatesSchema: JSONSchema<HistoricalEstatesRequest> = {
  type: 'object',
  properties: {
    block,
    tokenIds: { type: 'array', items: { type: 'string', pattern: '^[0-9]{1,78}$' }, maxItems: MAX_FILTER_VALUES },
    sizeGt: { type: 'integer', nullable: true },
    first,
    skip
  },
  required: ['block', 'tokenIds'],
  additionalProperties: false
}

export const HistoricalRentalAssetsSchema: JSONSchema<HistoricalRentalAssetsRequest> = {
  type: 'object',
  properties: {
    block,
    lessors: addresses,
    contractAddresses: { ...addresses, maxItems: MAX_CONTRACTS, nullable: true },
    isClaimed: { type: 'boolean', nullable: true },
    first,
    skip
  },
  required: ['block', 'lessors'],
  additionalProperties: false
}
