import { ChainId, Network } from '@dcl/schemas'
import {
  ERC20TradeAsset,
  ERC721TradeAsset,
  Trade,
  TradeAssetDirection,
  TradeAssetType,
  TradeCreation,
  TradeType
} from '@dcl/schemas/dist/dapps/trade'
import { fromDbTradeAndDBTradeAssetWithValueListToTrade } from '../../src/adapters/trades/trades'
import * as signatureUtils from '../../src/logic/trades/utils'
import { IPgComponent } from '../../src/ports/db/types'
import { DBTrade, DBTradeAsset, DBTradeAssetValue, ITradesComponent, createTradesComponent } from '../../src/ports/trades'
import { getInsertTradeAssetQuery, getInsertTradeAssetValueByTypeQuery, getInsertTradeQuery } from '../../src/ports/trades/queries'
import * as utils from '../../src/ports/trades/utils'
import { StatusCode } from '../../src/types'
import { RequestError } from '../../src/utils'

let mockTrade: TradeCreation
let mockSigner: string
let mockPg: IPgComponent
let tradesComponent: ITradesComponent

describe('when adding a new trade', () => {
  beforeEach(() => {
    mockSigner = '0x1234567890'
    mockTrade = {
      signer: mockSigner,
      signature: '123123',
      type: TradeType.BID,
      network: Network.ETHEREUM,
      chainId: ChainId.ETHEREUM_MAINNET,
      checks: {
        expiration: new Date().getTime() + 100000000000,
        effective: new Date().getTime(),
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

    const mockPgClient = {
      query: jest.fn()
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

    jest.clearAllMocks()
    tradesComponent = createTradesComponent({ dappsDatabase: mockPg })
  })

  describe('when the expiration date is in the past', () => {
    beforeEach(() => {
      mockTrade.checks = {
        ...mockTrade.checks,
        expiration: new Date('2021-01-01').getTime(),
        effective: new Date().getTime()
      }
    })

    it('should throw a RequestError with BAD_REQUEST status code', async () => {
      await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(
        new RequestError(StatusCode.BAD_REQUEST, 'Trade expiration date must be in the future')
      )
    })
  })

  describe('when the effective date is after expiration date', () => {
    beforeEach(() => {
      mockTrade.checks = {
        ...mockTrade.checks,
        expiration: new Date().getTime(),
        effective: new Date().getTime() + 1000
      }
    })
    it('should throw a RequestError with BAD_REQUEST status code', async () => {
      await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(
        new RequestError(StatusCode.BAD_REQUEST, 'Trade should be effective before expiration')
      )
    })
  })

  describe('when the trade structure is not valid for a given type', () => {
    beforeEach(() => {
      jest.spyOn(utils, 'validateTradeByType').mockResolvedValue(false)
    })

    it('should throw a RequestError with BAD_REQUEST status code', async () => {
      await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(
        new RequestError(StatusCode.BAD_REQUEST, `Trade structure is not valid for type ${mockTrade.type}`)
      )
    })
  })

  describe('when the trade signature is invalid', () => {
    beforeEach(() => {
      jest.spyOn(signatureUtils, 'validateTradeSignature').mockReturnValue(false)
      jest.spyOn(utils, 'validateTradeByType').mockResolvedValue(true)
    })

    it('should throw a RequestError with BAD_REQUEST status code', async () => {
      await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(
        new RequestError(StatusCode.BAD_REQUEST, 'Invalid signature')
      )
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

    beforeEach(async () => {
      jest.spyOn(signatureUtils, 'validateTradeSignature').mockReturnValue(true)
      jest.spyOn(utils, 'validateTradeByType').mockResolvedValue(true)
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
        signature: '123123',
        signer: '0x1234567890',
        type: mockTrade.type
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
  })
})
