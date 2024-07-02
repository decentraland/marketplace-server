import { ChainId, Network } from '@dcl/schemas'
import { TradeAssetType, TradeCreation, TradeType } from '@dcl/schemas/dist/dapps/trade'
import * as signatureUtils from '../../src/logic/trades/utils'
import { IPgComponent } from '../../src/ports/db/types'
import { ITradesComponent, createTradesComponent } from '../../src/ports/trades'
import * as utils from '../../src/ports/trades/utils'
import { StatusCode } from '../../src/types'
import { RequestError } from '../../src/utils'

let mockTrade: TradeCreation
let mockSigner: string
let mockPg: IPgComponent
let tradesComponent: ITradesComponent

describe('addTrade', () => {
  beforeEach(() => {
    mockTrade = {
      signer: '0x1234567890',
      signature: '123123',
      type: TradeType.BID,
      network: Network.ETHEREUM,
      chainId: ChainId.ETHEREUM_MAINNET,
      checks: {
        expiration: new Date().getTime() + 10000,
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
          value: '2',
          extra: ''
        }
      ],
      received: [
        {
          assetType: TradeAssetType.ERC721,
          contractAddress: '0x789abc',
          value: '1',
          extra: '',
          beneficiary: '0x9876543210'
        }
      ]
    }

    mockSigner = 'mockSigner'
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

  it('should throw a RequestError with BAD_REQUEST status code if expiration date is in the past', async () => {
    mockTrade.checks = {
      ...mockTrade.checks,
      expiration: new Date('2021-01-01').getTime(),
      effective: new Date().getTime()
    }

    await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(
      new RequestError(StatusCode.BAD_REQUEST, 'Expiration date must be in the future')
    )
  })

  it('should throw a RequestError with BAD_REQUEST status code if effective date is after expiration date', async () => {
    mockTrade.checks = {
      ...mockTrade.checks,
      expiration: new Date().getTime(),
      effective: new Date().getTime() + 1000
    }

    await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(
      new RequestError(StatusCode.BAD_REQUEST, 'Trade should be effective before expiration')
    )
  })

  it('should throw a RequestError with BAD_REQUEST status code if trade structure is not valid for the given type', async () => {
    jest.spyOn(utils, 'validateTradeByType').mockResolvedValue(false)
    await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(
      new RequestError(StatusCode.BAD_REQUEST, `Trade structure is not valid for type ${mockTrade.type}`)
    )
  })

  it('should throw a RequestError with BAD_REQUEST status code if the trade signature is invalid', async () => {
    jest.spyOn(signatureUtils, 'validateTradeSignature').mockReturnValue(false)
    jest.spyOn(utils, 'validateTradeByType').mockResolvedValue(true)

    await expect(tradesComponent.addTrade(mockTrade, mockSigner)).rejects.toThrow(
      new RequestError(StatusCode.BAD_REQUEST, 'Invalid signature')
    )
  })
})
