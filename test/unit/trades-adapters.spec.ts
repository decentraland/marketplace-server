import { TradeAssetType, TradeType } from '@dcl/schemas'
import { TradeAssetDirection } from '@dcl/schemas/dist/dapps/trade'
import {
  fromDBTradeAssetWithValueToTradeAsset,
  fromDBTradeAssetWithValueToTradeAssetWithBeneficiary,
  fromDbTradeAndDBTradeAssetWithValueListToTrade
} from '../../src/adapters/trades/trades'
import {
  DBTrade,
  DBTradeAssetWithCollectionItemValue,
  DBTradeAssetWithERC20Value,
  DBTradeAssetWithERC721Value,
  DBTradeAssetWithValue
} from '../../src/ports/trades'

let dbTrade: DBTrade
let dbTradeAssetWithValue: DBTradeAssetWithValue
let dbTradeAssetWithValueWithBeneficiary: DBTradeAssetWithValue

beforeEach(() => {
  dbTrade = {
    id: '123',
    signature: '123123123',
    signer: '0x1234567890',
    type: TradeType.BID,
    network: 'ETHEREUM',
    effective_since: new Date(),
    expires_at: new Date(),
    chain_id: 1,
    checks: {
      expiration: 1,
      effective: 1,
      uses: 1,
      salt: '',
      allowedRoot: '',
      contractSignatureIndex: 1,
      externalChecks: [],
      signerSignatureIndex: 1
    },
    created_at: new Date()
  }

  dbTradeAssetWithValue = {
    id: 'asset-1',
    asset_type: TradeAssetType.ERC20,
    contract_address: '0xabcdef',
    extra: '0x',
    direction: TradeAssetDirection.SENT,
    trade_id: dbTrade.id,
    created_at: new Date(),
    amount: '100'
  }

  dbTradeAssetWithValueWithBeneficiary = {
    id: 'asset-2',
    asset_type: TradeAssetType.ERC721,
    contract_address: '0x789abc',
    extra: '0x',
    direction: TradeAssetDirection.RECEIVED,
    beneficiary: '0x9876543210',
    trade_id: dbTrade.id,
    created_at: new Date(),
    token_id: '123'
  }
})

describe('when adapting a db trade with its assets to a trade', () => {
  it('should return the correct trade structure', () => {
    const result = fromDbTradeAndDBTradeAssetWithValueListToTrade(dbTrade, [dbTradeAssetWithValue, dbTradeAssetWithValueWithBeneficiary])

    expect(result).toEqual({
      id: dbTrade.id,
      signer: dbTrade.signer,
      type: dbTrade.type,
      network: dbTrade.network,
      chainId: dbTrade.chain_id,
      checks: dbTrade.checks,
      createdAt: dbTrade.created_at.getTime(),
      sent: [fromDBTradeAssetWithValueToTradeAsset(dbTradeAssetWithValue)],
      received: [fromDBTradeAssetWithValueToTradeAssetWithBeneficiary(dbTradeAssetWithValueWithBeneficiary)]
    })
  })
})

describe('when adapting a db trade asset with value to a trade asset', () => {
  describe('when trade asset should not have a beneficiary', () => {
    describe('and it is an ERC20 asset', () => {
      let erc20Asset: DBTradeAssetWithERC20Value

      beforeEach(() => {
        erc20Asset = {
          ...dbTradeAssetWithValue,
          asset_type: TradeAssetType.ERC20,
          amount: '100'
        }
      })

      it('should return trade asset with amount', () => {
        const result = fromDBTradeAssetWithValueToTradeAsset(erc20Asset)
        expect(result).toEqual({
          assetType: TradeAssetType.ERC20,
          contractAddress: erc20Asset.contract_address,
          extra: erc20Asset.extra,
          amount: erc20Asset.amount
        })
      })
    })

    describe('and it is an ERC721 asset', () => {
      let erc721Asset: DBTradeAssetWithERC721Value

      beforeEach(() => {
        erc721Asset = {
          ...dbTradeAssetWithValue,
          asset_type: TradeAssetType.ERC721,
          token_id: 'token_id_1'
        }
      })

      it('should return trade asset with the token id', () => {
        const result = fromDBTradeAssetWithValueToTradeAsset(erc721Asset)
        expect(result).toEqual({
          assetType: TradeAssetType.ERC721,
          contractAddress: erc721Asset.contract_address,
          extra: erc721Asset.extra,
          tokenId: erc721Asset.token_id
        })
      })
    })

    describe('and it is a collection item asset', () => {
      let collectionItemAsset: DBTradeAssetWithCollectionItemValue

      beforeEach(() => {
        collectionItemAsset = {
          ...dbTradeAssetWithValue,
          asset_type: TradeAssetType.COLLECTION_ITEM,
          item_id: 'item_id_1'
        }
      })

      it('should return trade asset with the item id', () => {
        const result = fromDBTradeAssetWithValueToTradeAsset(collectionItemAsset)
        expect(result).toEqual({
          assetType: TradeAssetType.COLLECTION_ITEM,
          contractAddress: collectionItemAsset.contract_address,
          extra: collectionItemAsset.extra,
          itemId: collectionItemAsset.item_id
        })
      })
    })
  })

  describe('when trade asset should have a beneficiary', () => {
    describe('and the beneficiary is not present', () => {
      it('should throw an error', () => {
        expect(() => fromDBTradeAssetWithValueToTradeAssetWithBeneficiary(dbTradeAssetWithValue)).toThrowError(
          'DBTradeAsset does not have a beneficiary'
        )
      })
    })

    describe('and it is an ERC20 asset', () => {
      let erc20Asset: DBTradeAssetWithERC20Value

      beforeEach(() => {
        erc20Asset = {
          ...dbTradeAssetWithValueWithBeneficiary,
          asset_type: TradeAssetType.ERC20,
          amount: '100'
        }
      })

      it('should return trade asset with amount and the beneficiary', () => {
        const result = fromDBTradeAssetWithValueToTradeAssetWithBeneficiary(erc20Asset)
        expect(result).toEqual({
          assetType: TradeAssetType.ERC20,
          contractAddress: erc20Asset.contract_address,
          extra: erc20Asset.extra,
          amount: erc20Asset.amount,
          beneficiary: erc20Asset.beneficiary
        })
      })
    })

    describe('and it is an ERC721 asset', () => {
      let erc721Asset: DBTradeAssetWithERC721Value

      beforeEach(() => {
        erc721Asset = {
          ...dbTradeAssetWithValueWithBeneficiary,
          asset_type: TradeAssetType.ERC721,
          token_id: 'token_id_1'
        }
      })

      it('should return trade asset with the token id and the beneficiary', () => {
        const result = fromDBTradeAssetWithValueToTradeAssetWithBeneficiary(erc721Asset)
        expect(result).toEqual({
          assetType: TradeAssetType.ERC721,
          contractAddress: erc721Asset.contract_address,
          extra: erc721Asset.extra,
          tokenId: erc721Asset.token_id,
          beneficiary: erc721Asset.beneficiary
        })
      })
    })

    describe('and it is a collection item asset', () => {
      let collectionItemAsset: DBTradeAssetWithCollectionItemValue

      beforeEach(() => {
        collectionItemAsset = {
          ...dbTradeAssetWithValueWithBeneficiary,
          asset_type: TradeAssetType.COLLECTION_ITEM,
          item_id: 'item_id_1'
        }
      })

      it('should return trade asset with the item id and the beneficiary', () => {
        const result = fromDBTradeAssetWithValueToTradeAssetWithBeneficiary(collectionItemAsset)
        expect(result).toEqual({
          assetType: TradeAssetType.COLLECTION_ITEM,
          contractAddress: collectionItemAsset.contract_address,
          extra: collectionItemAsset.extra,
          itemId: collectionItemAsset.item_id,
          beneficiary: collectionItemAsset.beneficiary
        })
      })
    })
  })
})
