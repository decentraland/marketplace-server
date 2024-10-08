import { formatEther } from 'ethers'
import {
  TradeAssetType,
  TradeType,
  TradeAssetDirection,
  Trade,
  Network,
  ChainId,
  Events,
  ERC20TradeAsset,
  NFTCategory,
  Rarity,
  ERC721TradeAsset
} from '@dcl/schemas'
import { getCategoryFromDBItem } from '../../src/adapters/items'
import {
  fromDBTradeAssetWithValueToTradeAsset,
  fromDBTradeAssetWithValueToTradeAssetWithBeneficiary,
  fromDbTradeAndDBTradeAssetWithValueListToTrade,
  fromTradeAndAssetsToEventNotification
} from '../../src/adapters/trades/trades'
import { DBItem } from '../../src/ports/items'
import { DBNFT } from '../../src/ports/nfts/types'
import {
  DBTrade,
  DBTradeAssetWithCollectionItemValue,
  DBTradeAssetWithERC20Value,
  DBTradeAssetWithERC721Value,
  DBTradeAssetWithValue,
  TradeEvent
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
      signature: dbTrade.signature,
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

describe('when adapting a trade and its assets to a notification event', () => {
  let trade: Trade
  let marketplaceBaseUrl: string

  beforeEach(() => {
    marketplaceBaseUrl = 'marketplace'
    process.env = { ...process.env, MARKETPLACE_BASE_URL: marketplaceBaseUrl }
    trade = {
      id: '1',
      createdAt: Date.now(),
      signer: '0x123',
      signature:
        '0x6e1ac0d382ee06b56c6376a9ea5a7641bc7efc6c50ea12728e09637072c60bf15574a2ced086ef1f7f8fbb4a6ab7b925e08c34c918f57d0b63e036eff21fa2ee1c',
      type: TradeType.BID,
      network: Network.ETHEREUM,
      chainId: ChainId.ETHEREUM_MAINNET,
      checks: {
        expiration: Date.now() + 100000000000,
        effective: Date.now(),
        uses: 1,
        salt: '',
        allowedRoot: '',
        contractSignatureIndex: 0,
        externalChecks: [],
        signerSignatureIndex: 0
      },
      sent: [
        {
          assetType: TradeAssetType.ERC20,
          contractAddress: '0xabcdef',
          amount: '2',
          extra: ''
        }
      ],
      received: [
        {
          assetType: TradeAssetType.ERC721,
          contractAddress: '0x789abc',
          tokenId: '1',
          extra: '',
          beneficiary: '0x9876543210'
        }
      ]
    }
  })
  describe('when the trade is a bid', () => {
    let asset: DBNFT
    beforeEach(() => {
      asset = {
        image: 'image.png',
        contract_address: 'contract-address',
        token_id: (trade.received[0] as ERC721TradeAsset).tokenId,
        owner: '0x123',
        category: NFTCategory.WEARABLE,
        rarity: Rarity.COMMON,
        name: 'asset name'
      } as DBNFT
    })
    describe('when the trade is created', () => {
      it('should return the correct event notification', () => {
        const result = fromTradeAndAssetsToEventNotification(trade, [asset], TradeEvent.CREATED, '0x123')
        expect(result).toEqual({
          type: Events.Type.MARKETPLACE,
          subType: Events.SubType.Marketplace.BID_RECEIVED,
          key: `bid-created-${trade.id}`,
          timestamp: expect.any(Number),
          metadata: {
            address: trade.signer,
            image: asset.image,
            seller: asset.owner,
            category: asset.category,
            rarity: asset.rarity,
            link: `${marketplaceBaseUrl}/account?section=bids`,
            nftName: asset.name,
            price: (trade.sent[0] as ERC20TradeAsset).amount,
            title: 'Bid Received',
            description: `You received a bid of ${formatEther((trade.sent[0] as ERC20TradeAsset).amount)} MANA for this ${asset.name}.`,
            network: trade.network
          }
        })
      })
    })

    describe('when the trade is accepted', () => {
      it('should return the correct event notification', () => {
        const result = fromTradeAndAssetsToEventNotification(trade, [asset], TradeEvent.ACCEPTED, '0x123')
        expect(result).toEqual({
          type: Events.Type.BLOCKCHAIN,
          subType: Events.SubType.Blockchain.BID_ACCEPTED,
          key: `bid-accepted-${trade.id}`,
          timestamp: expect.any(Number),
          metadata: {
            address: trade.signer,
            image: asset.image,
            seller: asset.owner,
            category: asset.category,
            rarity: asset.rarity,
            link: `${marketplaceBaseUrl}/contracts/${asset.contract_address}/tokens/${asset.token_id}`,
            nftName: asset.name,
            price: (trade.sent[0] as ERC20TradeAsset).amount,
            title: 'Bid Accepted',
            description: `Your bid for ${formatEther((trade.sent[0] as ERC20TradeAsset).amount)} MANA for this ${asset.name} was accepted.`,
            network: trade.network
          }
        })
      })
    })
  })

  describe('when a trade is a public nft order', () => {
    let asset: DBNFT
    beforeEach(() => {
      trade.type = TradeType.PUBLIC_NFT_ORDER
      asset = {
        image: 'image.png',
        contract_address: 'contract-address',
        token_id: (trade.received[0] as ERC721TradeAsset).tokenId,
        owner: '0x123',
        category: NFTCategory.WEARABLE,
        rarity: Rarity.COMMON,
        name: 'asset name'
      } as DBNFT
    })

    describe('when the trade is created', () => {
      it('should not send any notification', () => {
        const result = fromTradeAndAssetsToEventNotification(trade, [asset], TradeEvent.CREATED, '0x123')
        expect(result).toBeNull()
      })
    })

    describe('when the trade is accepted', () => {
      it('should return the correct event notification', () => {
        const result = fromTradeAndAssetsToEventNotification(trade, [asset], TradeEvent.ACCEPTED, '0x123')
        expect(result).toEqual({
          type: Events.Type.BLOCKCHAIN,
          subType: Events.SubType.Blockchain.ITEM_SOLD,
          key: `item-sold-${trade.id}`,
          timestamp: expect.any(Number),
          metadata: {
            address: trade.signer,
            image: asset.image,
            seller: asset.owner,
            buyer: '0x123',
            category: asset.category,
            rarity: asset.rarity,
            link: `${marketplaceBaseUrl}/contracts/${asset.contract_address}/tokens/${asset.token_id}`,
            nftName: asset.name,
            title: 'Item Sold',
            description: `Someone just bought your ${asset.name}`,
            network: trade.network,
            tokenId: asset.token_id
          }
        })
      })
    })
  })

  describe('when a trade is a public item order', () => {
    let asset: DBItem
    beforeEach(() => {
      trade.type = TradeType.PUBLIC_ITEM_ORDER
      asset = {
        image: 'image.png',
        contract_address: 'contract-address',
        item_id: (trade.received[0] as ERC721TradeAsset).tokenId,
        creator: '0x123',
        rarity: Rarity.COMMON,
        name: 'asset name'
      } as DBItem
    })

    describe('when the trade is created', () => {
      it('should not send any notification', () => {
        const result = fromTradeAndAssetsToEventNotification(trade, [asset], TradeEvent.CREATED, '0x123')
        expect(result).toBeNull()
      })
    })

    describe('when the trade is accepted', () => {
      it('should return the correct event notification', () => {
        const result = fromTradeAndAssetsToEventNotification(trade, [asset], TradeEvent.ACCEPTED, '0x123')
        expect(result).toEqual({
          type: Events.Type.BLOCKCHAIN,
          subType: Events.SubType.Blockchain.ITEM_SOLD,
          key: `item-sold-${trade.id}`,
          timestamp: expect.any(Number),
          metadata: {
            address: trade.signer,
            image: asset.image,
            seller: asset.creator,
            buyer: '0x123',
            category: getCategoryFromDBItem(asset),
            rarity: asset.rarity,
            link: `${marketplaceBaseUrl}/contracts/${asset.contract_address}/items/${asset.item_id}`,
            nftName: asset.name,
            title: 'Item Sold',
            description: `Someone just bought your ${asset.name}`,
            network: trade.network,
            tokenId: asset.item_id
          }
        })
      })
    })
  })

  describe('when a trade is not a valid type', () => {
    beforeEach(() => {
      trade = {
        ...trade,
        type: 'invalid' as TradeType
      }
    })

    it('should return null', () => {
      expect(fromTradeAndAssetsToEventNotification(trade, [], TradeEvent.CREATED, '0x123')).toBeNull()
    })
  })
})
