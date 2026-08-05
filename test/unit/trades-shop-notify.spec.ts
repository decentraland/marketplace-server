import { ILoggerComponent } from '@well-known-components/interfaces'
import { ChainId, Network, TradeAssetDirection, TradeAssetType, TradeCreation, TradeType } from '@dcl/schemas'
import * as signatureUtils from '../../src/logic/trades/utils'
import { IPgComponent } from '../../src/ports/db/types'
import { IEventPublisherComponent } from '../../src/ports/events/types'
import { IShopNotifierComponent } from '../../src/ports/shop-notifier/types'
import { DBTrade, DBTradeAsset, ITradesComponent, createTradesComponent } from '../../src/ports/trades'
import * as utils from '../../src/ports/trades/utils'
import { createTestLogsComponent } from '../components'

const VALID_SIGNATURE =
  '0x6e1ac0d382ee06b56c6376a9ea5a7641bc7efc6c50ea12728e09637072c60bf15574a2ced086ef1f7f8fbb4a6ab7b925e08c34c918f57d0b63e036eff21fa2ee1c'
const CONTRACT_ADDRESS = '0xcollectioncontract'

// addTrade fires the shop-notify ping fire-and-forget (not awaited), so let the background promise —
// itemId resolution + transition check + the notifier call — settle before asserting on it.
const flushBackground = () => new Promise(resolve => setImmediate(resolve))

let mockSigner: string
let mockPg: IPgComponent
let mockPgQuery: jest.Mock
let mockTopLevelQuery: jest.Mock
let mockEventPublisher: IEventPublisherComponent
let mockShopNotifier: IShopNotifierComponent
let notifyItemOnSaleMock: jest.Mock
let logs: ILoggerComponent
let tradesComponent: ITradesComponent

function buildValidChecks() {
  return {
    expiration: Date.now() + 100000000000,
    effective: Date.now(),
    uses: 1,
    salt: '',
    allowedRoot: '',
    contractSignatureIndex: 0,
    externalChecks: [],
    signerSignatureIndex: 0
  }
}

// Wires the transaction so the insert flow returns a persisted Trade built from the given sent asset
// row/value plus a received (priced) asset. Call order inside the tx mirrors the component:
// trade insert, sent asset insert, received asset insert, sent value insert, received value insert.
function stubTransaction(insertedTrade: DBTrade, sentAsset: DBTradeAsset, sentValue: object) {
  const receivedAsset: DBTradeAsset = {
    id: 'received-asset-1',
    trade_id: insertedTrade.id,
    asset_type: TradeAssetType.ERC20,
    contract_address: '0xmana',
    direction: TradeAssetDirection.RECEIVED,
    extra: '0x',
    beneficiary: '0xbuyer',
    created_at: new Date()
  }
  mockPgQuery
    .mockResolvedValueOnce({ rows: [insertedTrade] })
    .mockResolvedValueOnce({ rows: [sentAsset] })
    .mockResolvedValueOnce({ rows: [receivedAsset] })
    .mockResolvedValueOnce({ rows: [sentValue] })
    .mockResolvedValueOnce({ rows: [{ amount: '1000' }] })
}

describe('when adding a listing trade', () => {
  beforeEach(() => {
    mockSigner = '0x1234567890'
    mockPgQuery = jest.fn()
    mockTopLevelQuery = jest.fn()
    mockPg = {
      getPool: jest.fn(),
      withTransaction: jest.fn().mockImplementation((fn, _onError) => fn({ query: mockPgQuery })),
      withAsyncContextTransaction: jest.fn(),
      start: jest.fn(),
      query: mockTopLevelQuery,
      stop: jest.fn(),
      streamQuery: jest.fn()
    }
    notifyItemOnSaleMock = jest.fn().mockResolvedValue(undefined)
    mockShopNotifier = { notifyItemOnSale: notifyItemOnSaleMock }
    mockEventPublisher = { publishMessage: jest.fn() }
    logs = createTestLogsComponent({
      getLogger: jest.fn().mockReturnValue({ error: () => undefined, info: () => undefined, warn: () => undefined })
    })

    // Isolate the shop-notify path: signature/structure validations pass, the SNS notification is a no-op.
    jest.spyOn(signatureUtils, 'validateTradeSignature').mockReturnValue(true)
    jest.spyOn(signatureUtils, 'validateAssetOwnership').mockResolvedValue(true)
    jest.spyOn(utils, 'validateTradeByType').mockResolvedValue(true)
    jest.spyOn(utils, 'isValidEstateTrade').mockResolvedValue(true)
    jest.spyOn(utils, 'getNotificationEventForTrade').mockResolvedValue(null)

    tradesComponent = createTradesComponent({
      dappsDatabase: mockPg,
      eventPublisher: mockEventPublisher,
      logs,
      shopNotifier: mockShopNotifier
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('and the trade is a primary item order (PUBLIC_ITEM_ORDER)', () => {
    let itemOrderTrade: TradeCreation

    beforeEach(() => {
      itemOrderTrade = {
        signer: mockSigner,
        signature: VALID_SIGNATURE,
        type: TradeType.PUBLIC_ITEM_ORDER,
        network: Network.MATIC,
        chainId: ChainId.MATIC_MAINNET,
        checks: buildValidChecks(),
        sent: [{ assetType: TradeAssetType.COLLECTION_ITEM, contractAddress: CONTRACT_ADDRESS, itemId: '42', extra: '0x' }],
        received: [{ assetType: TradeAssetType.ERC20, contractAddress: '0xmana', amount: '1000', extra: '0x', beneficiary: '0xbuyer' }]
      }

      const insertedTrade: DBTrade = {
        id: 'listing-item-1',
        chain_id: itemOrderTrade.chainId,
        network: itemOrderTrade.network,
        checks: itemOrderTrade.checks,
        created_at: new Date(),
        effective_since: new Date(),
        expires_at: new Date(),
        signature: VALID_SIGNATURE,
        signer: mockSigner,
        type: TradeType.PUBLIC_ITEM_ORDER,
        contract: 'OffChainMarketplaceV2'
      }
      const sentAsset: DBTradeAsset = {
        id: 'sent-asset-1',
        trade_id: insertedTrade.id,
        asset_type: TradeAssetType.COLLECTION_ITEM,
        contract_address: CONTRACT_ADDRESS,
        direction: TradeAssetDirection.SENT,
        extra: '0x',
        created_at: new Date()
      }
      stubTransaction(insertedTrade, sentAsset, { item_id: '42' })
    })

    describe('and there is no other open listing for the item', () => {
      beforeEach(() => {
        mockTopLevelQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // transition check: none
      })

      it('should notify the shop with the resolved contract address and item id', async () => {
        await tradesComponent.addTrade(itemOrderTrade, mockSigner)
        await flushBackground()
        expect(notifyItemOnSaleMock).toHaveBeenCalledWith({ contractAddress: CONTRACT_ADDRESS, itemId: '42' })
      })
    })

    describe('and the item already has another open listing', () => {
      beforeEach(() => {
        mockTopLevelQuery.mockResolvedValueOnce({ rows: [{ exists: 1 }], rowCount: 1 }) // transition check: exists
      })

      it('should not notify the shop', async () => {
        await tradesComponent.addTrade(itemOrderTrade, mockSigner)
        await flushBackground()
        expect(notifyItemOnSaleMock).not.toHaveBeenCalled()
      })
    })

    describe('and the shop notifier rejects', () => {
      beforeEach(() => {
        mockTopLevelQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
        notifyItemOnSaleMock.mockRejectedValueOnce(new Error('network down'))
      })

      it('should still return the created trade without throwing', async () => {
        const response = await tradesComponent.addTrade(itemOrderTrade, mockSigner)
        await flushBackground()
        expect(response.id).toBe('listing-item-1')
      })
    })
  })

  describe('and the trade is a secondary nft order (PUBLIC_NFT_ORDER)', () => {
    let nftOrderTrade: TradeCreation

    beforeEach(() => {
      nftOrderTrade = {
        signer: mockSigner,
        signature: VALID_SIGNATURE,
        type: TradeType.PUBLIC_NFT_ORDER,
        network: Network.MATIC,
        chainId: ChainId.MATIC_MAINNET,
        checks: buildValidChecks(),
        sent: [{ assetType: TradeAssetType.ERC721, contractAddress: CONTRACT_ADDRESS, tokenId: '7', extra: '0x' }],
        received: [{ assetType: TradeAssetType.ERC20, contractAddress: '0xmana', amount: '1000', extra: '0x', beneficiary: '0xbuyer' }]
      }

      const insertedTrade: DBTrade = {
        id: 'listing-nft-1',
        chain_id: nftOrderTrade.chainId,
        network: nftOrderTrade.network,
        checks: nftOrderTrade.checks,
        created_at: new Date(),
        effective_since: new Date(),
        expires_at: new Date(),
        signature: VALID_SIGNATURE,
        signer: mockSigner,
        type: TradeType.PUBLIC_NFT_ORDER,
        contract: 'OffChainMarketplaceV2'
      }
      const sentAsset: DBTradeAsset = {
        id: 'sent-asset-nft-1',
        trade_id: insertedTrade.id,
        asset_type: TradeAssetType.ERC721,
        contract_address: CONTRACT_ADDRESS,
        direction: TradeAssetDirection.SENT,
        extra: '0x',
        created_at: new Date()
      }
      stubTransaction(insertedTrade, sentAsset, { token_id: '7' })

      // First top-level query resolves the ERC721 token to its item id; second is the transition check.
      mockTopLevelQuery.mockResolvedValueOnce({ rows: [{ item_id: '99' }], rowCount: 1 }).mockResolvedValueOnce({ rows: [], rowCount: 0 })
    })

    it('should resolve the item id from the token and notify the shop', async () => {
      await tradesComponent.addTrade(nftOrderTrade, mockSigner)
      await flushBackground()
      expect(notifyItemOnSaleMock).toHaveBeenCalledWith({ contractAddress: CONTRACT_ADDRESS, itemId: '99' })
    })
  })

  describe('and the trade is a bid (not a listing)', () => {
    let bidTrade: TradeCreation

    beforeEach(() => {
      bidTrade = {
        signer: mockSigner,
        signature: VALID_SIGNATURE,
        type: TradeType.BID,
        network: Network.ETHEREUM,
        chainId: ChainId.ETHEREUM_MAINNET,
        checks: buildValidChecks(),
        sent: [{ assetType: TradeAssetType.ERC20, contractAddress: '0xmana', amount: '1000', extra: '0x' }],
        received: [
          { assetType: TradeAssetType.ERC721, contractAddress: CONTRACT_ADDRESS, tokenId: '7', extra: '0x', beneficiary: '0xseller' }
        ]
      }

      const insertedTrade: DBTrade = {
        id: 'bid-1',
        chain_id: bidTrade.chainId,
        network: bidTrade.network,
        checks: bidTrade.checks,
        created_at: new Date(),
        effective_since: new Date(),
        expires_at: new Date(),
        signature: VALID_SIGNATURE,
        signer: mockSigner,
        type: TradeType.BID,
        contract: 'OffChainMarketplaceV2'
      }
      const sentAsset: DBTradeAsset = {
        id: 'bid-sent-asset-1',
        trade_id: insertedTrade.id,
        asset_type: TradeAssetType.ERC20,
        contract_address: '0xmana',
        direction: TradeAssetDirection.SENT,
        extra: '0x',
        created_at: new Date()
      }
      // Bid: sent is ERC20 (price), received is the ERC721; the received asset needs a beneficiary.
      mockPgQuery
        .mockResolvedValueOnce({ rows: [insertedTrade] })
        .mockResolvedValueOnce({ rows: [sentAsset] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'bid-received-asset-1',
              trade_id: insertedTrade.id,
              asset_type: TradeAssetType.ERC721,
              contract_address: CONTRACT_ADDRESS,
              direction: TradeAssetDirection.RECEIVED,
              extra: '0x',
              beneficiary: '0xseller',
              created_at: new Date()
            }
          ]
        })
        .mockResolvedValueOnce({ rows: [{ amount: '1000' }] })
        .mockResolvedValueOnce({ rows: [{ token_id: '7' }] })
    })

    it('should not notify the shop and should not query the materialized view', async () => {
      await tradesComponent.addTrade(bidTrade, mockSigner)
      await flushBackground()
      expect(notifyItemOnSaleMock).not.toHaveBeenCalled()
      expect(mockTopLevelQuery).not.toHaveBeenCalled()
    })
  })
})
