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
  Event,
  ListingStatus
} from '@dcl/schemas'
import { ContractName, getContract } from 'decentraland-transactions'
import { fromDbTradeAndDBTradeAssetWithValueListToTrade } from '../../src/adapters/trades/trades'
import * as signatureUtils from '../../src/logic/trades/utils'
import { TradeSignatureMatch } from '../../src/logic/trades/utils'
import { IPgComponent } from '../../src/ports/db/types'
import { IEventPublisherComponent } from '../../src/ports/events/types'
import { IShopNotifierComponent } from '../../src/ports/shop-notifier/types'
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
  MarketplaceContractPausedError,
  InvalidTradeStructureError,
  TradeAlreadyExpiredError,
  TradeEffectiveAfterExpirationError,
  TradeNetworkMismatchError,
  TradeNotFoundError
} from '../../src/ports/trades/errors'
import {
  getInsertTradeAssetQuery,
  getInsertTradeAssetValueByTypeQuery,
  getInsertTradeQuery,
  getMarketplaceContractPausedQuery,
  getTradeStatusByIdQuery
} from '../../src/ports/trades/queries'
import * as utils from '../../src/ports/trades/utils'
import { createTestLogsComponent } from '../components'
import { createContractStatusMockedComponent } from '../mocks/contract-status-mock'

let mockTrade: TradeCreation
let mockSigner: string
let mockPg: IPgComponent
let mockEventPublisher: IEventPublisherComponent
let mockShopNotifier: IShopNotifierComponent
let tradesComponent: ITradesComponent
let logs: ILoggerComponent
let publishMessageMock: jest.Mock
let notifyItemOnSaleMock: jest.Mock
let signatureMatch: TradeSignatureMatch

const MOCK_CANCELLATION_DIGEST = '0x491822dfcfd83072053748ee442b3c7d9f16b7827bad93773faf23e71fd82fcb'

describe('when adding a new trade', () => {
  beforeEach(() => {
    mockSigner = '0x1234567890'
    // A non-null digest on purpose: it is what a V3 trade carries, and asserting it as a literal below
    // means the trade recording a hardcoded null instead of what was resolved fails this test.
    signatureMatch = {
      contract: getContract(ContractName.OffChainMarketplaceV2, ChainId.ETHEREUM_MAINNET),
      cancellationDigest: MOCK_CANCELLATION_DIGEST
    }
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
      withAsyncContextTransaction: jest.fn(),
      start: jest.fn(),
      query: jest.fn(),
      stop: jest.fn(),
      streamQuery: jest.fn()
    }

    publishMessageMock = jest.fn()

    mockEventPublisher = {
      publishMessage: publishMessageMock
    }

    notifyItemOnSaleMock = jest.fn().mockResolvedValue(undefined)
    mockShopNotifier = {
      notifyItemOnSale: notifyItemOnSaleMock
    }

    logs = createTestLogsComponent({
      getLogger: jest.fn().mockReturnValue({ error: () => undefined, info: () => undefined, warn: () => undefined })
    })

    jest.clearAllMocks()
    tradesComponent = createTradesComponent({
      dappsDatabase: mockPg,
      eventPublisher: mockEventPublisher,
      logs,
      shopNotifier: mockShopNotifier,
      contractStatus: createContractStatusMockedComponent()
    })
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

  describe('when the network does not match the chain id', () => {
    beforeEach(() => {
      mockTrade = { ...mockTrade, network: Network.MATIC, chainId: ChainId.ETHEREUM_MAINNET }
      jest.spyOn(utils, 'validateTradeByType').mockResolvedValue(true)
    })

    it('should reject the trade with a TradeNetworkMismatchError', async () => {
      await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(
        new TradeNetworkMismatchError(Network.MATIC, ChainId.ETHEREUM_MAINNET)
      )
    })

    it('should not run the duplicate checks', async () => {
      await tradesComponent.addTrade(mockTrade, mockSigner).catch(() => undefined)
      expect(utils.validateTradeByType).not.toHaveBeenCalled()
    })
  })

  describe('when the chain id is not one the marketplace runs on', () => {
    beforeEach(() => {
      mockTrade = { ...mockTrade, chainId: 999999 as ChainId }
    })

    it('should reject the trade with a TradeNetworkMismatchError', async () => {
      await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(TradeNetworkMismatchError)
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

  describe('when the trade signature length is not 132 characters', () => {
    beforeEach(() => {
      mockTrade.signature = '0xshort'
      jest.spyOn(utils, 'validateTradeByType').mockResolvedValue(true)
      jest.spyOn(utils, 'isValidEstateTrade').mockResolvedValueOnce(true)
    })

    it('should throw an InvalidTradeSignatureError', async () => {
      await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(new InvalidTradeSignatureError())
    })
  })

  describe('when the trade signature is invalid', () => {
    beforeEach(() => {
      jest.spyOn(signatureUtils, 'resolveTradeSignature').mockReturnValue(null)
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
      jest.spyOn(signatureUtils, 'resolveTradeSignature').mockReturnValue(signatureMatch)
      jest.spyOn(utils, 'validateTradeByType').mockResolvedValue(true)
      jest.spyOn(utils, 'isValidEstateTrade').mockResolvedValueOnce(false)
    })

    it('should throw an EstateTradeWithoutFingerprintError', async () => {
      await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(new InvalidEstateTrade())
    })
  })

  describe('when the marketplace contract the trade resolves to is paused', () => {
    let queryMock: jest.Mock
    let withTransactionMock: jest.Mock

    beforeEach(() => {
      jest.spyOn(signatureUtils, 'resolveTradeSignature').mockReturnValue(signatureMatch)
      jest.spyOn(utils, 'validateTradeByType').mockResolvedValue(true)
      jest.spyOn(utils, 'isValidEstateTrade').mockResolvedValueOnce(true)
      queryMock = jest.fn().mockResolvedValueOnce({ rows: [{ paused: true }], rowCount: 1 })
      withTransactionMock = jest.fn()
      mockPg.query = queryMock
      mockPg.withTransaction = withTransactionMock
    })

    it('should reject the trade with a MarketplaceContractPausedError', async () => {
      await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(
        new MarketplaceContractPausedError(signatureMatch.contract.address, mockTrade.network)
      )
    })

    it('should look the status up for the resolved contract and the trade network', async () => {
      await tradesComponent.addTrade(mockTrade, mockSigner).catch(() => undefined)
      expect(queryMock).toHaveBeenCalledWith(getMarketplaceContractPausedQuery(signatureMatch.contract.address, mockTrade.network))
    })

    it('should not store the trade', async () => {
      await tradesComponent.addTrade(mockTrade, mockSigner).catch(() => undefined)
      expect(withTransactionMock).not.toHaveBeenCalled()
    })
  })

  describe('when the marketplace contract the trade resolves to was unpaused', () => {
    beforeEach(() => {
      jest.spyOn(signatureUtils, 'resolveTradeSignature').mockReturnValue(signatureMatch)
      jest.spyOn(utils, 'validateTradeByType').mockResolvedValue(true)
      jest.spyOn(utils, 'isValidEstateTrade').mockResolvedValueOnce(true)
      ;(mockPg.query as jest.Mock).mockResolvedValueOnce({ rows: [{ paused: false }], rowCount: 1 })
      ;(mockPg.withTransaction as jest.Mock).mockRejectedValueOnce(new Error('stop after the pause check'))
    })

    it('should go on to store the trade', async () => {
      await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow('stop after the pause check')
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
      jest.spyOn(signatureUtils, 'resolveTradeSignature').mockReturnValue(signatureMatch)
      jest.spyOn(utils, 'validateTradeByType').mockResolvedValue(true)
      jest.spyOn(utils, 'isValidEstateTrade').mockResolvedValueOnce(true)
      // No contract_status row: the marketplace was never paused.
      ;(mockPg.query as jest.Mock).mockResolvedValueOnce({ rows: [], rowCount: 0 })
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
      expect(mockPgQuery).toHaveBeenCalledWith(
        getInsertTradeQuery({ ...mockTrade, contract: signatureMatch.contract.address, tradeDigest: MOCK_CANCELLATION_DIGEST }, mockSigner)
      )
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
        withAsyncContextTransaction: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        streamQuery: jest.fn(),
        query: jest.fn().mockResolvedValue({ rowCount: 0 })
      }

      mockEventPublisher = {
        publishMessage: publishMessageMock
      }
      tradesComponent = createTradesComponent({
        dappsDatabase: mockPg,
        eventPublisher: mockEventPublisher,
        logs,
        shopNotifier: mockShopNotifier,
        contractStatus: createContractStatusMockedComponent()
      })
    })

    it('should throw TradeNotFoundError', async () => {
      expect(async () => await tradesComponent.getTrade('1')).rejects.toThrow(new TradeNotFoundError('1').message)
    })
  })

  describe('when there is a trade with the given id', () => {
    let assets: (DBTrade & DBTradeAssetWithValue)[]
    let trade: Trade
    let mockQuery: jest.Mock

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
        withAsyncContextTransaction: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        streamQuery: jest.fn(),
        // Each context below sets mockQuery after this runs.
        query: jest.fn((...args: unknown[]) => mockQuery(...args))
      }
      const mockEventPublisher = {
        publishMessage: jest.fn()
      }

      tradesComponent = createTradesComponent({
        dappsDatabase: mockPg,
        eventPublisher: mockEventPublisher,
        logs,
        shopNotifier: mockShopNotifier,
        contractStatus: createContractStatusMockedComponent()
      })
    })

    describe('and it is open on a marketplace that is not paused', () => {
      beforeEach(() => {
        mockQuery = jest
          .fn()
          .mockResolvedValueOnce({ rows: assets, rowCount: 2 })
          .mockResolvedValueOnce({ rows: [{ status: ListingStatus.OPEN, paused: false }], rowCount: 1 })
      })

      it('should return the trade with its status and not paused', async () => {
        await expect(tradesComponent.getTrade('1')).resolves.toEqual({ ...trade, status: ListingStatus.OPEN, isPaused: false })
      })

      it('should compute the status with the query for the trade type and id', async () => {
        await tradesComponent.getTrade('1')
        expect(mockQuery).toHaveBeenNthCalledWith(2, getTradeStatusByIdQuery(TradeType.BID, '1', []))
      })
    })

    describe('and its marketplace contract is paused', () => {
      beforeEach(() => {
        mockQuery = jest
          .fn()
          .mockResolvedValueOnce({ rows: assets, rowCount: 2 })
          .mockResolvedValueOnce({ rows: [{ status: ListingStatus.OPEN, paused: true }], rowCount: 1 })
      })

      it('should return the trade as open and paused', async () => {
        await expect(tradesComponent.getTrade('1')).resolves.toEqual({ ...trade, status: ListingStatus.OPEN, isPaused: true })
      })
    })

    describe('and it was cancelled', () => {
      beforeEach(() => {
        mockQuery = jest
          .fn()
          .mockResolvedValueOnce({ rows: assets, rowCount: 2 })
          .mockResolvedValueOnce({ rows: [{ status: ListingStatus.CANCELLED, paused: false }], rowCount: 1 })
      })

      it('should return the trade with the cancelled status', async () => {
        await expect(tradesComponent.getTrade('1')).resolves.toEqual({ ...trade, status: ListingStatus.CANCELLED, isPaused: false })
      })
    })
  })
})

describe('when getting the trades of an address', () => {
  let tradesComponent: ITradesComponent
  let mockQuery: jest.Mock
  let result: Awaited<ReturnType<ITradesComponent['getTradesByAddress']>>

  function assetRow(tradeId: string, contract: string) {
    return {
      trade_id: tradeId,
      trade_chain_id: ChainId.MATIC_AMOY,
      trade_checks: {},
      trade_created_at: new Date(1000),
      trade_effective_since: new Date(1000),
      trade_expires_at: new Date(2000),
      trade_network: Network.MATIC,
      trade_signature: '0xsig',
      trade_signer: '0xuser',
      trade_type: TradeType.PUBLIC_ITEM_ORDER,
      trade_contract: contract,
      asset_id: `${tradeId}-asset`,
      asset_type: TradeAssetType.ERC20,
      asset_beneficiary: '0xuser',
      asset_contract_address: '0xmana',
      asset_direction: TradeAssetDirection.RECEIVED,
      asset_extra: '0x',
      asset_trade_id: tradeId,
      asset_created_at: new Date(1000),
      token_id: null,
      amount: '10',
      item_id: null
    }
  }

  beforeEach(async () => {
    mockQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [assetRow('paused-trade', '0xPAUSED'), assetRow('live-trade', '0xlive')], rowCount: 2 })
    tradesComponent = createTradesComponent({
      dappsDatabase: { query: mockQuery } as unknown as IPgComponent,
      eventPublisher: { publishMessage: jest.fn() },
      logs: createTestLogsComponent({
        getLogger: jest.fn().mockReturnValue({ error: () => undefined, info: () => undefined, warn: () => undefined })
      }),
      shopNotifier: { notifyItemOnSale: jest.fn() },
      contractStatus: createContractStatusMockedComponent([{ address: '0xpaused', network: Network.MATIC }])
    })
    result = await tradesComponent.getTradesByAddress('0xuser')
  })

  it('should flag each trade with whether its marketplace is paused', () => {
    expect(result.data.map(trade => [trade.id, trade.isPaused])).toEqual([
      ['paused-trade', true],
      ['live-trade', false]
    ])
  })
})

describe('when getting every trade', () => {
  let tradesComponent: ITradesComponent
  let rows: { id: string; contract: string; network: string }[]
  let result: Awaited<ReturnType<ITradesComponent['getTrades']>>

  beforeEach(async () => {
    rows = [
      { id: '1', contract: '0xPAUSED', network: Network.MATIC },
      { id: '2', contract: '0xpaused', network: Network.ETHEREUM }
    ]
    tradesComponent = createTradesComponent({
      dappsDatabase: { query: jest.fn().mockResolvedValueOnce({ rows, rowCount: 2 }) } as unknown as IPgComponent,
      eventPublisher: { publishMessage: jest.fn() },
      logs: createTestLogsComponent({
        getLogger: jest.fn().mockReturnValue({ error: () => undefined, info: () => undefined, warn: () => undefined })
      }),
      shopNotifier: { notifyItemOnSale: jest.fn() },
      contractStatus: createContractStatusMockedComponent([{ address: '0xpaused', network: Network.MATIC }])
    })
    result = await tradesComponent.getTrades()
  })

  // The same address on another network is a different deployment.
  it('should flag each raw row by its contract and network, and return the count', () => {
    expect(result).toEqual({
      data: [
        { ...rows[0], paused: true },
        { ...rows[1], paused: false }
      ],
      count: 2
    })
  })
})
