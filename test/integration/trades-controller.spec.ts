import { Response } from 'node-fetch'
import SQL from 'sql-template-strings'
import { Network, TradeAssetType, TradeCreation, TradeType } from '@dcl/schemas'
import { ERC20TradeAsset, ERC721TradeAsset } from '@dcl/schemas/dist/dapps/trade'
import * as tradeUtils from '../../src/logic/trades/utils'
import { StatusCode } from '../../src/types'
import { test } from '../components'
import { getSignedFetchRequest } from '../utils'

test('trades controller', function ({ components }) {
  beforeEach(() => {
    jest.spyOn(tradeUtils, 'validateTradeSignature').mockImplementation(() => true)
  })

  describe('when inserting a bid', () => {
    let bid: TradeCreation
    let response: Response
    let signer: string

    beforeEach(() => {
      bid = {
        signature: Math.random().toString(),
        signer: '0xtest',
        chainId: 1,
        type: TradeType.BID,
        checks: {
          effective: Date.now(),
          expiration: Date.now() + 1000,
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

    describe('and the bid is valid', () => {
      beforeEach(async () => {
        const { localFetch } = components
        const signedRequest = await getSignedFetchRequest('POST', '/v1/trades', {
          intent: 'dcl:marketplace:create-trade',
          signer: 'dcl:marketplace'
        })
        signer = signedRequest.identity.realAccount.address.toLowerCase()
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
              direction: 'sent',
              contract_address: bid.sent[0].contractAddress,
              asset_type: bid.sent[0].assetType
            }),
            expect.objectContaining({
              direction: 'received',
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
          SQL`SELECT * FROM marketplace.trade_assets as ta, marketplace.trade_assets_erc20 as erc20 WHERE trade_id = (SELECT id FROM marketplace.trades WHERE signature = ${bid.signature}) AND erc20.asset_id = ta.id AND ta.direction = 'sent'`
        )
        expect(queryResult.rows).toEqual([
          expect.objectContaining({ asset_type: TradeAssetType.ERC20, amount: (bid.sent[0] as ERC20TradeAsset).amount })
        ])
      })

      it('should insert trade asset erc721 values in db', async () => {
        const { dappsDatabase } = components
        const queryResult = await dappsDatabase.query(
          SQL`SELECT * FROM marketplace.trade_assets as ta, marketplace.trade_assets_erc721 as erc721 WHERE trade_id = (SELECT id FROM marketplace.trades WHERE signature = ${bid.signature}) AND erc721.asset_id = ta.id AND ta.direction = 'received'`
        )
        expect(queryResult.rows).toEqual([expect.objectContaining({ token_id: (bid.received[0] as ERC721TradeAsset).tokenId })])
      })

      it('should return 200 status with trade body', async () => {
        expect(response.status).toEqual(StatusCode.CREATED)
        const { signature, ...responseBid } = bid
        expect(await response.json()).toEqual({
          data: { ...responseBid, id: expect.any(String), createdAt: expect.any(Number), signer },
          ok: true
        })
      })
    })

    describe('and there is already another bid for that item of that signer', () => {
      beforeEach(async () => {
        const { localFetch } = components
        const signedRequest = await getSignedFetchRequest('POST', '/v1/trades', {
          intent: 'dcl:marketplace:create-trade',
          signer: 'dcl:marketplace'
        })
        signer = signedRequest.identity.realAccount.address.toLowerCase()
        await localFetch.fetch('/v1/trades', {
          method: 'POST',
          body: JSON.stringify({ ...bid, signer }),
          headers: { ...signedRequest.headers, 'Content-Type': 'application/json' }
        })
        response = await localFetch.fetch('/v1/trades', {
          method: 'POST',
          body: JSON.stringify({ ...bid, signer }),
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
})
