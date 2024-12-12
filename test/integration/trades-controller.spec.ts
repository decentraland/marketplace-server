import { Response } from 'node-fetch'
import SQL from 'sql-template-strings'
import { Authenticator } from '@dcl/crypto'
import {
  Network,
  TradeAssetType,
  TradeCreation,
  TradeType,
  CollectionItemTradeAsset,
  ERC20TradeAsset,
  ERC721TradeAsset,
  TradeAssetDirection,
  ChainId
} from '@dcl/schemas'
import * as chainIdUtils from '../../src/logic/chainIds'
import * as tradeUtils from '../../src/logic/trades/utils'
import { StatusCode } from '../../src/types'
import { test } from '../components'
import { getSignedFetchRequest } from '../utils'

test('trades controller', function ({ components }) {
  beforeEach(() => {
    jest.spyOn(tradeUtils, 'validateTradeSignature').mockImplementation(() => true)
    jest.spyOn(chainIdUtils, 'getEthereumChainId').mockReturnValue(ChainId.ETHEREUM_SEPOLIA)
    jest.spyOn(chainIdUtils, 'getPolygonChainId').mockReturnValue(ChainId.MATIC_AMOY)
  })

  describe('when inserting a bid', () => {
    let bid: TradeCreation
    let response: Response
    let signer: string

    beforeEach(() => {
      bid = {
        signature: Math.random().toString(),
        signer: '0xtest', // the value stored will be change in the test as the signer is the one that signed the request
        chainId: 1,
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
            tokenId: '100',
            extra: '0x',
            beneficiary: '0x9d32aac179153a991e832550d9f96441ea27763b'
          }
        ]
      }
    })

    describe('and the bid is on an nft', () => {
      beforeEach(() => {
        bid = {
          ...bid,
          received: [
            {
              assetType: TradeAssetType.ERC721,
              contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
              tokenId: '100',
              extra: '0x',
              beneficiary: '0x9d32aac179153a991e832550d9f96441ea27763b'
            }
          ]
        }
      })
      describe('and the bid is valid', () => {
        beforeEach(async () => {
          const { localFetch } = components
          const signedRequest = await getSignedFetchRequest('POST', '/v1/trades', {
            intent: 'dcl:create-trade',
            signer: 'dcl:marketplace'
          })
          signer = signedRequest.identity.realAccount.address.toLowerCase()
          bid = {
            ...bid,
            signer,
            signature: Authenticator.createSignature(signedRequest.identity.realAccount, bid.signature)
          }
          response = await localFetch.fetch('/v1/trades', {
            method: signedRequest.method,
            body: JSON.stringify(bid),
            headers: { ...signedRequest.headers, 'Content-Type': 'application/json' }
          })
        })

        it('should insert a new trade in db', async () => {
          const { dappsDatabase } = components
          const queryResult = await dappsDatabase.query(SQL`SELECT * FROM marketplace.trades WHERE signature = ${bid.signature}`)
          expect(queryResult.rowCount).toBe(1)
        })

        it('should insert trade assets in db', async () => {
          const { dappsDatabase } = components
          const queryResult = await dappsDatabase.query(
            SQL`SELECT * FROM marketplace.trade_assets WHERE trade_id = (SELECT id FROM marketplace.trades WHERE signature = ${bid.signature})`
          )
          expect(queryResult.rows).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                direction: TradeAssetDirection.SENT,
                contract_address: bid.sent[0].contractAddress,
                asset_type: bid.sent[0].assetType
              }),
              expect.objectContaining({
                direction: TradeAssetDirection.RECEIVED,
                contract_address: bid.received[0].contractAddress,
                asset_type: bid.received[0].assetType,
                beneficiary: bid.received[0].beneficiary
              })
            ])
          )
        })

        it('should insert trade asset erc20 values in db', async () => {
          const { dappsDatabase } = components
          const queryResult = await dappsDatabase.query(
            SQL`SELECT * FROM marketplace.trade_assets as ta, marketplace.trade_assets_erc20 as erc20 WHERE trade_id = (SELECT id FROM marketplace.trades WHERE signature = ${bid.signature}) AND erc20.asset_id = ta.id AND ta.direction = ${TradeAssetDirection.SENT}`
          )
          expect(queryResult.rows).toEqual([
            expect.objectContaining({ asset_type: TradeAssetType.ERC20, amount: (bid.sent[0] as ERC20TradeAsset).amount })
          ])
        })

        it('should insert trade asset erc721 values in db', async () => {
          const { dappsDatabase } = components
          const queryResult = await dappsDatabase.query(
            SQL`SELECT * FROM marketplace.trade_assets as ta, marketplace.trade_assets_erc721 as erc721 WHERE trade_id = (SELECT id FROM marketplace.trades WHERE signature = ${bid.signature}) AND erc721.asset_id = ta.id AND ta.direction = ${TradeAssetDirection.RECEIVED}`
          )
          expect(queryResult.rows).toEqual([expect.objectContaining({ token_id: (bid.received[0] as ERC721TradeAsset).tokenId })])
        })

        it('should return 201 status with trade body', async () => {
          expect(response.status).toEqual(StatusCode.CREATED)
          expect(await response.json()).toEqual({
            data: { ...bid, id: expect.any(String), createdAt: expect.any(Number), signer },
            ok: true
          })
        })
      })
    })

    describe('and the bid is on an item', () => {
      beforeEach(() => {
        bid = {
          ...bid,
          received: [
            {
              assetType: TradeAssetType.COLLECTION_ITEM,
              contractAddress: '0x9d32aac179153a991e832550d9f96441ea27763b',
              itemId: '1',
              extra: '0x',
              beneficiary: '0x9d32aac179153a991e832550d9f96441ea27763b'
            }
          ]
        }
      })

      describe('and the bid is valid', () => {
        beforeEach(async () => {
          const { localFetch } = components
          const signedRequest = await getSignedFetchRequest('POST', '/v1/trades', {
            intent: 'dcl:create-trade',
            signer: 'dcl:marketplace'
          })
          signer = signedRequest.identity.realAccount.address.toLowerCase()
          bid = {
            ...bid,
            signer,
            signature: Authenticator.createSignature(signedRequest.identity.realAccount, bid.signature)
          }
          response = await localFetch.fetch('/v1/trades', {
            method: signedRequest.method,
            body: JSON.stringify(bid),
            headers: { ...signedRequest.headers, 'Content-Type': 'application/json' }
          })
        })

        it('should insert a new trade in db', async () => {
          const { dappsDatabase } = components
          const queryResult = await dappsDatabase.query(SQL`SELECT * FROM marketplace.trades WHERE signature = ${bid.signature}`)
          expect(queryResult.rowCount).toBe(1)
        })

        it('should insert trade assets in db', async () => {
          const { dappsDatabase } = components
          const queryResult = await dappsDatabase.query(
            SQL`SELECT * FROM marketplace.trade_assets WHERE trade_id = (SELECT id FROM marketplace.trades WHERE signature = ${bid.signature})`
          )
          expect(queryResult.rows).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                direction: TradeAssetDirection.SENT,
                contract_address: bid.sent[0].contractAddress,
                asset_type: bid.sent[0].assetType
              }),
              expect.objectContaining({
                direction: TradeAssetDirection.RECEIVED,
                contract_address: bid.received[0].contractAddress,
                asset_type: bid.received[0].assetType,
                beneficiary: bid.received[0].beneficiary
              })
            ])
          )
        })

        it('should insert trade asset erc20 values in db', async () => {
          const { dappsDatabase } = components
          const queryResult = await dappsDatabase.query(
            SQL`SELECT * FROM marketplace.trade_assets as ta, marketplace.trade_assets_erc20 as erc20 WHERE trade_id = (SELECT id FROM marketplace.trades WHERE signature = ${bid.signature}) AND erc20.asset_id = ta.id AND ta.direction = ${TradeAssetDirection.SENT}`
          )
          expect(queryResult.rows).toEqual([
            expect.objectContaining({ asset_type: TradeAssetType.ERC20, amount: (bid.sent[0] as ERC20TradeAsset).amount })
          ])
        })

        it('should insert trade asset item values in db', async () => {
          const { dappsDatabase } = components
          const queryResult = await dappsDatabase.query(
            SQL`SELECT * FROM marketplace.trade_assets as ta, marketplace.trade_assets_item as item WHERE trade_id = (SELECT id FROM marketplace.trades WHERE signature = ${bid.signature}) AND item.asset_id = ta.id AND ta.direction = ${TradeAssetDirection.RECEIVED}`
          )
          expect(queryResult.rows).toEqual([expect.objectContaining({ item_id: (bid.received[0] as CollectionItemTradeAsset).itemId })])
        })

        it('should return 201 status with trade body', async () => {
          expect(response.status).toEqual(StatusCode.CREATED)
          expect(await response.json()).toEqual({
            data: { ...bid, id: expect.any(String), createdAt: expect.any(Number), signer },
            ok: true
          })
        })
      })
    })

    describe('and there is already another bid for that item of that signer', () => {
      beforeEach(async () => {
        const { localFetch } = components
        const signedRequest = await getSignedFetchRequest('POST', '/v1/trades', {
          intent: 'dcl:create-trade',
          signer: 'dcl:marketplace'
        })
        signer = signedRequest.identity.realAccount.address.toLowerCase()
        const signature = Authenticator.createSignature(signedRequest.identity.realAccount, bid.signature)

        await localFetch.fetch('/v1/trades', {
          method: 'POST',
          body: JSON.stringify({
            ...bid,
            signer,
            signature
          }),
          headers: { ...signedRequest.headers, 'Content-Type': 'application/json' }
        })
        response = await localFetch.fetch('/v1/trades', {
          method: 'POST',
          body: JSON.stringify({
            ...bid,
            signer,
            signature
          }),
          headers: { ...signedRequest.headers, 'Content-Type': 'application/json' }
        })
      })

      it('should return 400 status', async () => {
        expect(response.status).toEqual(StatusCode.CONFLICT)
        expect(await response.json()).toEqual({
          message: 'There is already a bid with the same parameters',
          ok: false
        })
      })
    })
  })

  describe('when getting a trade', () => {
    let trade: TradeCreation
    let response: Response

    beforeEach(async () => {
      const { localFetch } = components
      const signedRequest = await getSignedFetchRequest('POST', '/v1/trades', {
        intent: 'dcl:create-trade',
        signer: 'dcl:marketplace'
      })
      trade = {
        signature: Authenticator.createSignature(signedRequest.identity.realAccount, Math.random().toString()),
        signer: signedRequest.identity.realAccount.address.toLowerCase(),
        chainId: 1,
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
            tokenId: '100',
            extra: '0x',
            beneficiary: '0x9d32aac179153a991e832550d9f96441ea27763b'
          }
        ]
      }
      const createdTradeResponse = await localFetch.fetch('/v1/trades', {
        method: signedRequest.method,
        body: JSON.stringify(trade),
        headers: { ...signedRequest.headers, 'Content-Type': 'application/json' }
      })
      const createdTrade = (await createdTradeResponse.json()).data
      response = await localFetch.fetch(`/v1/trades/${createdTrade.id}`, {
        method: 'GET',
        headers: signedRequest.headers
      })
    })

    it('should return 200 status with trade body', async () => {
      expect(response.status).toEqual(StatusCode.OK)
      expect(await response.json()).toEqual({
        data: { ...trade, id: expect.any(String), createdAt: expect.any(Number) },
        ok: true
      })
    })
  })
})
