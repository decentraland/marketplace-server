import { IPgComponent } from '@well-known-components/pg-component'
import { formatEther } from 'ethers'
import {
  Network,
  ChainId,
  Trade,
  TradeAssetType,
  TradeType,
  ERC721TradeAsset,
  Events,
  Rarity,
  NFTCategory,
  ERC20TradeAsset,
  WearableCategory,
  CollectionItemTradeAsset,
  Event
} from '@dcl/schemas'
import * as chainIdUtils from '../../src/logic/chainIds'
import { getItemByItemIdQuery } from '../../src/ports/items/queries'
import { DBItem } from '../../src/ports/items/types'
import { getNftByTokenIdQuery } from '../../src/ports/nfts/queries'
import { DBNFT } from '../../src/ports/nfts/types'
import { TradeEvent } from '../../src/ports/trades'
import { InvalidTradeStructureError } from '../../src/ports/trades/errors'
import { getNotificationEventForTrade, validateTradeByType } from '../../src/ports/trades/utils'

describe('when calling getNotificationEventForTrade function', () => {
  let mockPgComponent: IPgComponent
  let mockPgQuery: jest.Mock
  let trade: Trade
  let response: Event | null

  beforeEach(() => {
    mockPgQuery = jest.fn()

    mockPgComponent = {
      query: mockPgQuery
    } as unknown as IPgComponent

    trade = {
      id: '1',
      createdAt: Date.now(),
      signature: '0xsignature',
      signer: '0xsigner',
      chainId: ChainId.ETHEREUM_SEPOLIA,
      type: TradeType.BID,
      checks: {
        effective: Date.now(),
        expiration: Date.now() + 1000000,
        allowedRoot: '0x',
        contractSignatureIndex: 0,
        signerSignatureIndex: 0,
        externalChecks: [],
        salt: '0x',
        uses: 1
      },
      network: Network.ETHEREUM,
      sent: [
        {
          assetType: TradeAssetType.ERC20,
          contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763a',
          extra: '0x',
          amount: '100'
        }
      ],
      received: [
        {
          assetType: TradeAssetType.ERC721,
          contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
          tokenId: 'atokenid',
          extra: '0x',
          beneficiary: '0x9d32aac179153a991e832550d9f96441ea27763b'
        }
      ]
    }
  })

  describe('when inserted trade is a bid', () => {
    describe('when bidded asset is an nft', () => {
      let nftBid: Trade
      let dbNFT: DBNFT

      beforeEach(async () => {
        nftBid = {
          ...trade,
          received: [
            {
              assetType: TradeAssetType.ERC721,
              contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
              tokenId: 'atokenid',
              extra: '0x',
              beneficiary: '0x9d32aac179153a991e832550d9f96441ea27763b'
            }
          ]
        }
        dbNFT = {
          id: '1',
          contract_address: '0xaddr',
          token_id: (nftBid.received[0] as ERC721TradeAsset).tokenId,
          network: Network.ETHEREUM,
          created_at: Date.now(),
          url: 'url',
          updated_at: Date.now(),
          sold_at: Date.now(),
          urn: 'an-urn',
          owner: '0x123',
          image: 'an-image',
          issued_id: '1',
          item_id: '1',
          rarity: Rarity.COMMON,
          category: NFTCategory.WEARABLE,
          name: 'a name'
        }
        mockPgQuery.mockResolvedValue({ rows: [dbNFT] })
        response = await getNotificationEventForTrade(nftBid, mockPgComponent, TradeEvent.CREATED)
      })

      it('should fetch asset from database', () => {
        expect(mockPgQuery).toHaveBeenCalledWith(
          getNftByTokenIdQuery(nftBid.received[0].contractAddress, (nftBid.received[0] as ERC721TradeAsset).tokenId, nftBid.network)
        )
      })

      it('should return event', () => {
        expect(response).toEqual({
          type: Events.Type.MARKETPLACE,
          subType: Events.SubType.Marketplace.BID_RECEIVED,
          key: `bid-created-${trade.id}`,
          timestamp: trade.createdAt,
          metadata: {
            address: dbNFT.owner,
            image: dbNFT.image,
            seller: dbNFT.owner,
            category: dbNFT.category,
            rarity: dbNFT.rarity,
            link: `${process.env.MARKETPLACE_BASE_URL}/account?section=bids`,
            nftName: dbNFT.name,
            price: (trade.sent[0] as ERC20TradeAsset).amount,
            title: 'Bid Received',
            description: `You received a bid of ${formatEther((trade.sent[0] as ERC20TradeAsset).amount)} MANA for this ${dbNFT.name}.`,
            network: trade.network
          }
        })
      })
    })

    describe('when bidded asset is an nft', () => {
      let dbBid: Trade
      let dbItem: DBItem

      beforeEach(async () => {
        dbBid = {
          ...trade,
          received: [
            {
              assetType: TradeAssetType.COLLECTION_ITEM,
              contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
              itemId: 'anItemId',
              extra: '0x',
              beneficiary: '0x9d32aac179153a991e832550d9f96441ea27763b'
            }
          ]
        }
        dbItem = {
          id: '1',
          contract_address: '0xaddr',
          created_at: Date.now(),
          updated_at: Date.now(),
          sold_at: Date.now(),
          urn: 'an-urn',
          image: 'an-image',
          item_id: (dbBid.received[0] as CollectionItemTradeAsset).itemId,
          rarity: Rarity.COMMON,
          name: 'a name',
          available: 0,
          beneficiary: 'x123',
          category: WearableCategory.BODY_SHAPE,
          creator: '0x123',
          price: '123',
          reviewed_at: Date.now(),
          uri: 'uri'
        }
        mockPgQuery.mockResolvedValue({ rows: [dbItem] })
        response = await getNotificationEventForTrade(dbBid, mockPgComponent, TradeEvent.CREATED)
      })

      it('should fetch asset from database', () => {
        expect(mockPgQuery).toHaveBeenCalledWith(
          getItemByItemIdQuery(dbBid.received[0].contractAddress, (dbBid.received[0] as CollectionItemTradeAsset).itemId)
        )
      })

      it('should publish message', () => {
        expect(response).toEqual({
          type: Events.Type.MARKETPLACE,
          subType: Events.SubType.Marketplace.BID_RECEIVED,
          key: `bid-created-${trade.id}`,
          timestamp: trade.createdAt,
          metadata: {
            address: dbItem.creator,
            image: dbItem.image,
            seller: dbItem.creator,
            category: dbItem.category,
            rarity: dbItem.rarity,
            link: `${process.env.MARKETPLACE_BASE_URL}/account?section=bids`,
            nftName: dbItem.name,
            price: (trade.sent[0] as ERC20TradeAsset).amount,
            title: 'Bid Received',
            description: `You received a bid of ${formatEther((trade.sent[0] as ERC20TradeAsset).amount)} MANA for this ${dbItem.name}.`,
            network: trade.network
          }
        })
      })
    })
  })
})

describe('when validating trade by type', () => {
  let pgClient: IPgComponent
  let queryMock: jest.Mock
  let trade: Trade

  beforeEach(() => {
    queryMock = jest.fn().mockResolvedValue({ rowCount: 0, rows: [] })
    pgClient = {
      query: queryMock
    } as unknown as IPgComponent

    jest.spyOn(chainIdUtils, 'getPolygonChainId').mockImplementation(() => ChainId.MATIC_AMOY)
    jest.spyOn(chainIdUtils, 'getEthereumChainId').mockImplementation(() => ChainId.ETHEREUM_SEPOLIA)

    trade = {
      id: '1',
      createdAt: Date.now(),
      signature: '0xsignature',
      signer: '0xsigner',
      chainId: ChainId.ETHEREUM_SEPOLIA,
      type: TradeType.BID,
      checks: {
        effective: Date.now(),
        expiration: Date.now() + 1000000,
        allowedRoot: '0x',
        contractSignatureIndex: 0,
        signerSignatureIndex: 0,
        externalChecks: [],
        salt: '0x',
        uses: 1
      },
      network: Network.ETHEREUM,
      sent: [
        {
          assetType: TradeAssetType.ERC20,
          contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763a',
          extra: '0x',
          amount: '100'
        }
      ],
      received: [
        {
          assetType: TradeAssetType.ERC721,
          contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
          tokenId: 'atokenid',
          extra: '0x',
          beneficiary: '0x9d32aac179153a991e832550d9f96441ea27763b'
        }
      ]
    }
  })

  describe('when trade is a bid', () => {
    beforeEach(() => {
      trade.type = TradeType.BID
    })

    describe('and the sent asset is not an ERC20 asset', () => {
      beforeEach(() => {
        trade.sent = [
          {
            assetType: TradeAssetType.ERC721,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763a',
            tokenId: 'atokenid',
            extra: '0x'
          }
        ]
      })

      it('should throw InvalidTradeStructure error', () => {
        expect(validateTradeByType(trade, pgClient)).rejects.toEqual(new InvalidTradeStructureError(trade.type))
      })
    })

    describe('and the receive asset is not an ERC721 or CollectionItem asset', () => {
      beforeEach(() => {
        trade.received = [
          {
            assetType: TradeAssetType.ERC20,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
            amount: '100',
            extra: '0x',
            beneficiary: '0x123'
          }
        ]
      })

      it('should throw InvalidTradeStructure error', () => {
        expect(validateTradeByType(trade, pgClient)).rejects.toEqual(new InvalidTradeStructureError(trade.type))
      })
    })

    describe('and there is more than one sent asset', () => {
      beforeEach(() => {
        trade.sent = [
          {
            assetType: TradeAssetType.ERC20,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763a',
            amount: '100',
            extra: '0x'
          },
          {
            assetType: TradeAssetType.ERC20,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
            amount: '100',
            extra: '0x'
          }
        ]
      })

      it('should throw InvalidTradeStructure error', () => {
        expect(validateTradeByType(trade, pgClient)).rejects.toEqual(new InvalidTradeStructureError(trade.type))
      })
    })

    describe('and there is more than one receive assets', () => {
      beforeEach(() => {
        trade.received = [
          {
            assetType: TradeAssetType.ERC721,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
            tokenId: 'atokenid',
            extra: '0x',
            beneficiary: '0x9d32aac179153a991e832550d9f96441ea27763b'
          },
          {
            assetType: TradeAssetType.ERC20,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
            amount: '100',
            extra: '0x',
            beneficiary: '0x123'
          }
        ]
      })

      it('should throw InvalidTradeStructure error', () => {
        expect(validateTradeByType(trade, pgClient)).rejects.toEqual(new InvalidTradeStructureError(trade.type))
      })
    })

    describe('and the trades is correctly defined', () => {
      it('should return true', () => {
        expect(validateTradeByType(trade, pgClient)).resolves.toBe(true)
      })
    })
  })

  describe('when trade is a public nft order', () => {
    beforeEach(() => {
      trade.type = TradeType.PUBLIC_NFT_ORDER
    })

    describe('and the sent asset is not an ERC721 asset', () => {
      beforeEach(() => {
        trade.sent = [
          {
            assetType: TradeAssetType.COLLECTION_ITEM,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763a',
            itemId: 'anitemid',
            extra: '0x'
          }
        ]
      })

      it('should throw InvalidTradeStructure error', () => {
        expect(validateTradeByType(trade, pgClient)).rejects.toEqual(new InvalidTradeStructureError(trade.type))
      })
    })

    describe('and the receive asset is not an ERC20', () => {
      beforeEach(() => {
        trade.received = [
          {
            assetType: TradeAssetType.ERC721,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
            tokenId: 'atokenId',
            extra: '0x',
            beneficiary: '0x123'
          }
        ]
      })

      it('should throw InvalidTradeStructure error', () => {
        expect(validateTradeByType(trade, pgClient)).rejects.toEqual(new InvalidTradeStructureError(trade.type))
      })
    })

    describe('and there is more than one sent asset', () => {
      beforeEach(() => {
        trade.sent = [
          {
            assetType: TradeAssetType.ERC721,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763a',
            tokenId: '100',
            extra: '0x'
          },
          {
            assetType: TradeAssetType.ERC20,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
            amount: '100',
            extra: '0x'
          }
        ]
      })

      it('should throw InvalidTradeStructure error', () => {
        expect(validateTradeByType(trade, pgClient)).rejects.toEqual(new InvalidTradeStructureError(trade.type))
      })
    })

    describe('and there is more than one receive assets', () => {
      beforeEach(() => {
        trade.received = [
          {
            assetType: TradeAssetType.ERC721,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
            tokenId: 'atokenid',
            extra: '0x',
            beneficiary: '0x9d32aac179153a991e832550d9f96441ea27763b'
          },
          {
            assetType: TradeAssetType.ERC20,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
            amount: '100',
            extra: '0x',
            beneficiary: '0x123'
          }
        ]
      })

      it('should throw InvalidTradeStructure error', () => {
        expect(validateTradeByType(trade, pgClient)).rejects.toEqual(new InvalidTradeStructureError(trade.type))
      })
    })

    describe('and the trades is correctly defined', () => {
      beforeEach(() => {
        trade.received = [
          {
            assetType: TradeAssetType.ERC20,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
            amount: '100',
            extra: '0x',
            beneficiary: '0x123'
          }
        ]

        trade.sent = [
          {
            assetType: TradeAssetType.ERC721,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763a',
            tokenId: 'atokenid',
            extra: '0x'
          }
        ]
      })

      it('should return true', () => {
        expect(validateTradeByType(trade, pgClient)).resolves.toBe(true)
      })
    })
  })

  describe('when trade is a public item order', () => {
    beforeEach(() => {
      trade.type = TradeType.PUBLIC_ITEM_ORDER
    })

    describe('and the sent asset is not a COLLECTION ITEM asset', () => {
      beforeEach(() => {
        trade.sent = [
          {
            assetType: TradeAssetType.ERC721,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763a',
            tokenId: 'atokenId',
            extra: '0x'
          }
        ]
      })

      it('should throw InvalidTradeStructure error', () => {
        expect(validateTradeByType(trade, pgClient)).rejects.toEqual(new InvalidTradeStructureError(trade.type))
      })
    })

    describe('and the receive asset is not an ERC20', () => {
      beforeEach(() => {
        trade.received = [
          {
            assetType: TradeAssetType.ERC721,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
            tokenId: 'atokenId',
            extra: '0x',
            beneficiary: '0x123'
          }
        ]
      })

      it('should throw InvalidTradeStructure error', () => {
        expect(validateTradeByType(trade, pgClient)).rejects.toEqual(new InvalidTradeStructureError(trade.type))
      })
    })

    describe('and there is more than one sent asset', () => {
      beforeEach(() => {
        trade.sent = [
          {
            assetType: TradeAssetType.ERC721,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763a',
            tokenId: '100',
            extra: '0x'
          },
          {
            assetType: TradeAssetType.ERC20,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
            amount: '100',
            extra: '0x'
          }
        ]
      })

      it('should throw InvalidTradeStructure error', () => {
        expect(validateTradeByType(trade, pgClient)).rejects.toEqual(new InvalidTradeStructureError(trade.type))
      })
    })

    describe('and there is more than one receive assets', () => {
      beforeEach(() => {
        trade.received = [
          {
            assetType: TradeAssetType.ERC721,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
            tokenId: 'atokenid',
            extra: '0x',
            beneficiary: '0x9d32aac179153a991e832550d9f96441ea27763b'
          },
          {
            assetType: TradeAssetType.ERC20,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
            amount: '100',
            extra: '0x',
            beneficiary: '0x123'
          }
        ]
      })

      it('should throw InvalidTradeStructure error', () => {
        expect(validateTradeByType(trade, pgClient)).rejects.toEqual(new InvalidTradeStructureError(trade.type))
      })
    })

    describe('and the trades is correctly defined', () => {
      beforeEach(() => {
        trade.received = [
          {
            assetType: TradeAssetType.ERC20,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
            amount: '100',
            extra: '0x',
            beneficiary: '0x123'
          }
        ]

        trade.sent = [
          {
            assetType: TradeAssetType.COLLECTION_ITEM,
            contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763a',
            itemId: 'anitemid',
            extra: '0x'
          }
        ]
      })

      it('should return true', () => {
        expect(validateTradeByType(trade, pgClient)).resolves.toBe(true)
      })
    })
  })
})
