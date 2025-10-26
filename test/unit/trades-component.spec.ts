import { ILoggerComponent } from '@well-known-components/interfaces'
import {
  ChainId,
  Network,
  ERC20TradeAsset,
  ERC721TradeAsset,
  Trade,
  TradeAssetDirection,
  TradeAssetType,
  TradeCreation,
  TradeType,
  Events,
  NFTCategory,
  Rarity,
  Event
} from '@dcl/schemas'
import { fromDbTradeAndDBTradeAssetWithValueListToTrade } from '../../src/adapters/trades/trades'
import * as signatureUtils from '../../src/logic/trades/utils'
import { IPgComponent } from '../../src/ports/db/types'
import { IEventPublisherComponent } from '../../src/ports/events/types'
import {
  DBTrade,
  DBTradeAsset,
  DBTradeAssetValue,
  DBTradeAssetWithValue,
  ITradesComponent,
  createTradesComponent
} from '../../src/ports/trades'
import {
  InvalidEstateTrade,
  InvalidTradeSignatureError,
  InvalidTradeStructureError,
  TradeAlreadyExpiredError,
  TradeEffectiveAfterExpirationError,
  TradeNotFoundError
} from '../../src/ports/trades/errors'
import { getInsertTradeAssetQuery, getInsertTradeAssetValueByTypeQuery, getInsertTradeQuery } from '../../src/ports/trades/queries'
import * as utils from '../../src/ports/trades/utils'
import { createTestLogsComponent } from '../components'

let mockTrade: TradeCreation
let mockSigner: string
let mockPg: IPgComponent
let mockEventPublisher: IEventPublisherComponent
let tradesComponent: ITradesComponent
let logs: ILoggerComponent
let publishMessageMock: jest.Mock

describe('when adding a new trade', () => {
  beforeEach(() => {
    mockSigner = '0x1234567890'
    mockTrade = {
      signer: mockSigner,
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
          extra: '0x'
        }
      ],
      received: [
        {
          assetType: TradeAssetType.ERC721,
          contractAddress: '0x789abc',
          tokenId: '1',
          extra: '0x',
          beneficiary: '0x9876543210'
        }
      ]
    }

    const mockPgClient = {
      query: jest.fn(),
      release: jest.fn()
    }
    mockPg = {
      getPool: jest.fn().mockReturnValue({
        connect: jest.fn().mockResolvedValue(mockPgClient)
      }),
      withTransaction: jest.fn(),
      start: jest.fn(),
      query: jest.fn(),
      stop: jest.fn(),
      streamQuery: jest.fn()
    }

    publishMessageMock = jest.fn()

    mockEventPublisher = {
      publishMessage: publishMessageMock
    }

    logs = createTestLogsComponent({
      getLogger: jest.fn().mockReturnValue({ error: () => undefined, info: () => undefined })
    })

    jest.clearAllMocks()
    tradesComponent = createTradesComponent({ dappsDatabase: mockPg, eventPublisher: mockEventPublisher, logs })
  })

  describe('when the expiration date is in the past', () => {
    beforeEach(() => {
      mockTrade.checks = {
        ...mockTrade.checks,
        expiration: new Date('2021-01-01').getTime(),
        effective: new Date().getTime()
      }
    })

    it('should throw a TradeAlreadyExpiredError', async () => {
      await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(new TradeAlreadyExpiredError())
    })
  })

  describe('when the effective date is after expiration date', () => {
    beforeEach(() => {
      mockTrade.checks = {
        ...mockTrade.checks,
        effective: mockTrade.checks.expiration + 1000
      }
    })
    it('should throw a TradeEffectiveAfterExpirationError', async () => {
      await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(new TradeEffectiveAfterExpirationError())
    })
  })

  describe('when the trade structure is not valid for a given type', () => {
    beforeEach(() => {
      jest.spyOn(utils, 'validateTradeByType').mockResolvedValue(false)
      jest.spyOn(utils, 'isValidEstateTrade').mockResolvedValueOnce(true)
    })

    it('should throw an InvalidTradeStructureError', async () => {
      await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(new InvalidTradeStructureError(mockTrade.type))
    })
  })

  describe('when the trade signature is invalid', () => {
    beforeEach(() => {
      jest.spyOn(signatureUtils, 'validateTradeSignature').mockReturnValue(false)
      jest.spyOn(utils, 'validateTradeByType').mockResolvedValue(true)
      jest.spyOn(utils, 'isValidEstateTrade').mockResolvedValueOnce(true)
    })

    it('should throw an InvalidTradeSignatureError', async () => {
      await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(new InvalidTradeSignatureError())
    })
  })

  describe('when a estate trade is not valid in the available estate chain ids', () => {
    beforeEach(() => {
      mockTrade.chainId = ChainId.ETHEREUM_SEPOLIA
      jest.spyOn(signatureUtils, 'validateTradeSignature').mockReturnValue(true)
      jest.spyOn(utils, 'validateTradeByType').mockResolvedValue(true)
      jest.spyOn(utils, 'isValidEstateTrade').mockResolvedValueOnce(false)
    })

    it('should throw an EstateTradeWithoutFingerprintError', async () => {
      await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(new InvalidEstateTrade())
    })
  })

  describe('when the trade passes all validations', () => {
    let mockPgQuery: jest.Mock
    let insertedTrade: DBTrade
    let insertedSentAsset: DBTradeAsset
    let insertedSentAssetValue: DBTradeAssetValue
    let insertedReceivedAsset: DBTradeAsset
    let insertedReceivedAssetValue: DBTradeAssetValue
    let response: Trade
    let event: Event

    beforeEach(async () => {
      jest.spyOn(signatureUtils, 'validateTradeSignature').mockReturnValue(true)
      jest.spyOn(utils, 'validateTradeByType').mockResolvedValue(true)
      jest.spyOn(utils, 'isValidEstateTrade').mockResolvedValueOnce(true)
      mockPgQuery = jest.fn()
      ;(mockPg.withTransaction as jest.Mock).mockImplementation((fn, _onError) => fn({ query: mockPgQuery }))

      insertedTrade = {
        id: '1',
        chain_id: mockTrade.chainId,
        network: mockTrade.network,
        checks: mockTrade.checks,
        created_at: new Date(),
        effective_since: new Date(),
        expires_at: new Date(),
        signature:
          '0x6e1ac0d382ee06b56c6376a9ea5a7641bc7efc6c50ea12728e09637072c60bf15574a2ced086ef1f7f8fbb4a6ab7b925e08c34c918f57d0b63e036eff21fa2ee1c',
        signer: '0x1234567890',
        type: mockTrade.type,
        contract: 'OffChainMarketplace'
      }

      insertedSentAsset = {
        id: '1',
        trade_id: insertedTrade.id,
        asset_type: mockTrade.sent[0].assetType,
        contract_address: mockTrade.sent[0].contractAddress,
        direction: TradeAssetDirection.SENT,
        extra: mockTrade.sent[0].extra,
        created_at: new Date()
      }

      insertedSentAssetValue = {
        amount: (mockTrade.sent[0] as ERC20TradeAsset).amount
      }

      insertedReceivedAsset = {
        id: '2',
        trade_id: insertedTrade.id,
        asset_type: mockTrade.received[0].assetType,
        contract_address: mockTrade.received[0].contractAddress,
        direction: TradeAssetDirection.RECEIVED,
        extra: mockTrade.received[0].extra,
        beneficiary: mockTrade.received[0].beneficiary,
        created_at: new Date()
      }

      insertedReceivedAssetValue = {
        token_id: (mockTrade.received[0] as ERC721TradeAsset).tokenId
      }

      mockPgQuery
        .mockResolvedValueOnce({ rows: [insertedTrade] }) // trade insert
        .mockResolvedValueOnce({ rows: [insertedSentAsset] }) // trade sent asset insert
        .mockResolvedValueOnce({ rows: [insertedReceivedAsset] }) // trade received asset insert
        .mockResolvedValueOnce({ rows: [insertedSentAssetValue] }) // trade sent asset value insert
        .mockResolvedValueOnce({ rows: [insertedReceivedAssetValue] }) // trade received asset insert

      event = {
        type: Events.Type.MARKETPLACE,
        subType: Events.SubType.Marketplace.BID_RECEIVED,
        key: 'bid-created-1',
        timestamp: Date.now(),
        metadata: {
          address: '0x123',
          image: 'image.png',
          seller: '0x123',
          category: NFTCategory.WEARABLE,
          rarity: Rarity.COMMON,
          link: '/account?section=bids',
          nftName: 'nft name',
          price: '123123',
          title: 'Bid Received',
          description: 'You received a bid of 1 MANA for this nft name.',
          network: Network.ETHEREUM
        }
      }
      jest.spyOn(utils, 'getNotificationEventForTrade').mockResolvedValue(event)

      response = await tradesComponent.addTrade(mockTrade, mockSigner)
    })

    it('should add the trade to the database', async () => {
      expect(mockPgQuery).toHaveBeenCalledWith(getInsertTradeQuery(mockTrade, mockSigner))
    })

    it('should add sent asset to db', () => {
      expect(mockPgQuery).toHaveBeenCalledWith(getInsertTradeAssetQuery(mockTrade.sent[0], insertedTrade.id, TradeAssetDirection.SENT))
      expect(mockPgQuery).toHaveBeenCalledWith(getInsertTradeAssetValueByTypeQuery(mockTrade.sent[0], insertedSentAsset.id))
    })

    it('should add received asset to db', () => {
      expect(mockPgQuery).toHaveBeenCalledWith(
        getInsertTradeAssetQuery(mockTrade.received[0], insertedTrade.id, TradeAssetDirection.RECEIVED)
      )
      expect(mockPgQuery).toHaveBeenCalledWith(getInsertTradeAssetValueByTypeQuery(mockTrade.received[0], insertedReceivedAsset.id))
    })

    it('should return added trade', () => {
      expect(response).toEqual(
        fromDbTradeAndDBTradeAssetWithValueListToTrade(insertedTrade, [
          { ...insertedSentAsset, ...insertedSentAssetValue },
          { ...insertedReceivedAsset, ...insertedReceivedAssetValue }
        ])
      )
    })

    it('should send event notification', () => {
      expect(publishMessageMock).toHaveBeenCalledWith(event)
    })
  })
})

describe('when getting a trade', () => {
  let tradesComponent: ITradesComponent

  describe('when there is no trade with the given id', () => {
    beforeEach(() => {
      const mockPg = {
        getPool: jest.fn(),
        withTransaction: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        streamQuery: jest.fn(),
        query: jest.fn().mockResolvedValue({ rowCount: 0 })
      }

      mockEventPublisher = {
        publishMessage: publishMessageMock
      }
      tradesComponent = createTradesComponent({ dappsDatabase: mockPg, eventPublisher: mockEventPublisher, logs })
    })

    it('should throw TradeNotFoundError', async () => {
      expect(async () => await tradesComponent.getTrade('1')).rejects.toThrow(new TradeNotFoundError('1').message)
    })
  })

  describe('when there is a trade with the given id', () => {
    let assets: (DBTrade & DBTradeAssetWithValue)[]
    let trade: Trade

    beforeEach(() => {
      trade = {
        id: '1',
        createdAt: Date.now(),
        signer: mockSigner,
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
            extra: '0x'
          }
        ],
        received: [
          {
            assetType: TradeAssetType.ERC721,
            contractAddress: '0x789abc',
            tokenId: '1',
            extra: '0x',
            beneficiary: '0x9876543210'
          }
        ],
        contract: 'OffChainMarketplace'
      }

      assets = [
        {
          id: trade.id,
          signature: trade.signature,
          chain_id: trade.chainId,
          network: trade.network,
          checks: trade.checks,
          created_at: new Date(trade.createdAt),
          effective_since: new Date(trade.checks.effective),
          expires_at: new Date(trade.checks.expiration),
          signer: trade.signer,
          type: trade.type,
          contract: trade.contract,
          asset_type: TradeAssetType.ERC20,
          contract_address: trade.sent[0].contractAddress,
          direction: TradeAssetDirection.SENT,
          amount: (trade.sent[0] as ERC20TradeAsset).amount,
          extra: trade.sent[0].extra,
          trade_id: '1'
        },
        {
          id: trade.id,
          signature: trade.signature,
          chain_id: trade.chainId,
          network: trade.network,
          checks: trade.checks,
          created_at: new Date(trade.createdAt),
          effective_since: new Date(trade.checks.effective),
          expires_at: new Date(trade.checks.expiration),
          signer: trade.signer,
          type: trade.type,
          contract: trade.contract,
          asset_type: TradeAssetType.ERC721,
          contract_address: trade.received[0].contractAddress,
          direction: TradeAssetDirection.RECEIVED,
          token_id: (trade.received[0] as ERC721TradeAsset).tokenId,
          extra: trade.received[0].extra,
          beneficiary: trade.received[0].beneficiary,
          trade_id: '1'
        }
      ]

      const mockPg = {
        getPool: jest.fn(),
        withTransaction: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        streamQuery: jest.fn(),
        query: jest.fn().mockResolvedValue({ rows: assets, rowCount: 2 })
      }
      const mockEventPublisher = {
        publishMessage: jest.fn()
      }

      tradesComponent = createTradesComponent({ dappsDatabase: mockPg, eventPublisher: mockEventPublisher, logs })
    })

    it('should return trade', async () => {
      await expect(tradesComponent.getTrade('1')).resolves.toEqual(trade)
    })
  })
})
