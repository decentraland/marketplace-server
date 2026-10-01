import { getAddress, hexlify, randomBytes } from 'ethers'
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
import { ContractName, getContract } from 'decentraland-transactions'
import * as chainIdUtils from '../../src/logic/chainIds'
import * as tradeUtils from '../../src/logic/trades/utils'
import { StatusCode } from '../../src/types'
import { test } from '../components'
import { getSignedFetchRequest } from '../utils'

const MANA_MAINNET_ADDRESS = getContract(ContractName.MANAToken, ChainId.ETHEREUM_MAINNET).address

test('trades controller', function ({ components }) {
  beforeEach(() => {
    // Resolving the signature reports which marketplace version signed it and that version's EIP-712
    // digest, both of which the trade records. The fixtures carry a placeholder signature, so this stands
    // in for real verification the way the old validateTradeSignature mock did.
    jest.spyOn(tradeUtils, 'resolveTradeSignature').mockImplementation(() => ({
      contract: getContract(ContractName.OffChainMarketplaceV2, ChainId.ETHEREUM_MAINNET),
      cancellationDigest: null
    }))
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
            contractAddress: MANA_MAINNET_ADDRESS,
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
            data: { ...bid, id: expect.any(String), createdAt: expect.any(Number), signer, contract: expect.any(String) },
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
            data: { ...bid, id: expect.any(String), createdAt: expect.any(Number), signer, contract: expect.any(String) },
            ok: true
          })
        })
      })

      describe('and there is already another item bid for that signer', () => {
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

        it('should respond with a 409 conflict error', async () => {
          expect(response.status).toEqual(StatusCode.CONFLICT)
          expect(await response.json()).toEqual({
            message: 'There is already a bid with the same parameters',
            ok: false
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
    let createdTrade: { id: string }

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
            contractAddress: MANA_MAINNET_ADDRESS,
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
      createdTrade = (await createdTradeResponse.json()).data
      response = await localFetch.fetch(`/v1/trades/${createdTrade.id}`, {
        method: 'GET',
        headers: signedRequest.headers
      })
    })

    it('should return 200 status with the trade body carrying the trade id (not the joined asset id)', async () => {
      expect(response.status).toEqual(StatusCode.OK)
      const body = await response.json()
      expect(body).toEqual({
        data: { ...trade, id: expect.any(String), createdAt: expect.any(Number), contract: expect.any(String) },
        ok: true
      })
      // Regression guard: trades and trade_assets both have an `id` column, so a `SELECT t.*, ta.*`
      // let the asset's id clobber the trade's id — the endpoint returned the trade with its ASSET's
      // id. Assert the returned id is the trade's own id (matches the POST response + the URL param).
      expect(body.data.id).toEqual(createdTrade.id)
    })
  })

  describe('when listing trades', () => {
    let signerA: string
    let signerB: string
    let contractA: string
    let contractB: string
    let contractC: string
    let tradeIds: string[]
    let response: Response
    let body: { ok: boolean; data: { data: { id: string }[]; count: number } }

    const randomAddress = (): string => hexlify(randomBytes(20)).toLowerCase()

    async function insertTrade(signer: string, contract: string, hoursAgo: number): Promise<string> {
      const signature = hexlify(randomBytes(65))
      const result = await components.dappsDatabase.query<{ id: string }>(SQL`
        INSERT INTO marketplace.trades (signature, hashed_signature, signer, type, network, chain_id, checks, expires_at, effective_since, contract, created_at)
        VALUES (${signature}, ${signature}, ${signer}, ${TradeType.BID}, ${Network.ETHEREUM}, 1, ${{ uses: 1 }},
          NOW() + INTERVAL '1 day', NOW(), ${contract}, NOW() - (${hoursAgo} * INTERVAL '1 hour'))
        RETURNING id`)
      return result.rows[0].id
    }

    async function list(query: string): Promise<void> {
      response = await components.localFetch.fetch(`/v1/trades${query}`)
      body = await response.json()
    }

    const ids = (): string[] => body.data.data.map(trade => trade.id)

    beforeEach(async () => {
      signerA = randomAddress()
      signerB = randomAddress()
      contractA = randomAddress()
      contractB = randomAddress()
      contractC = randomAddress()
      // Index order is newest first; the first trade stores its contract checksummed.
      tradeIds = [
        await insertTrade(signerA, getAddress(contractA), 1),
        await insertTrade(signerA, contractB, 2),
        await insertTrade(signerB, contractA, 3),
        await insertTrade(signerB, contractC, 4)
      ]
    })

    afterEach(async () => {
      await components.dappsDatabase.query(SQL`DELETE FROM marketplace.trades WHERE id = ANY(${tradeIds})`)
    })

    describe('and no parameters are given', () => {
      let total: number

      beforeEach(async () => {
        const countResult = await components.dappsDatabase.query<{ count: number }>(
          SQL`SELECT COUNT(*)::int AS count FROM marketplace.trades`
        )
        total = countResult.rows[0].count
        await list('')
      })

      it('should respond with every trade and their total as the count', () => {
        expect({ status: response.status, length: body.data.data.length, count: body.data.count }).toEqual({
          status: StatusCode.OK,
          length: total,
          count: total
        })
      })

      it('should include the inserted trades', () => {
        expect(ids()).toEqual(expect.arrayContaining(tradeIds))
      })
    })

    describe('and a signer is given', () => {
      beforeEach(async () => {
        await list(`?signer=${getAddress(signerA)}`)
      })

      it("should respond with the signer's trades, newest first", () => {
        expect(body.data).toEqual({
          data: [expect.objectContaining({ id: tradeIds[0] }), expect.objectContaining({ id: tradeIds[1] })],
          count: 2
        })
      })
    })

    describe('and a contract is given', () => {
      beforeEach(async () => {
        await list(`?contract=${contractA}`)
      })

      it('should respond with the trades of that contract regardless of the stored casing', () => {
        expect({ ids: ids(), count: body.data.count }).toEqual({ ids: [tradeIds[0], tradeIds[2]], count: 2 })
      })
    })

    describe('and several contracts are given', () => {
      beforeEach(async () => {
        await list(`?contract=${contractA}&contract=${getAddress(contractB)}`)
      })

      it('should respond with the trades of any of those contracts', () => {
        expect({ ids: ids(), count: body.data.count }).toEqual({ ids: [tradeIds[0], tradeIds[1], tradeIds[2]], count: 3 })
      })
    })

    describe('and a signer and a contract are given', () => {
      beforeEach(async () => {
        await list(`?signer=${signerA}&contract=${contractA}`)
      })

      it('should respond with the trades matching both', () => {
        expect({ ids: ids(), count: body.data.count }).toEqual({ ids: [tradeIds[0]], count: 1 })
      })
    })

    describe('and first and skip are given', () => {
      beforeEach(async () => {
        await list(`?contract=${contractA}&contract=${contractB}&contract=${contractC}&first=2&skip=1`)
      })

      it('should respond with that page and the count of every matching trade', () => {
        expect({ ids: ids(), count: body.data.count }).toEqual({ ids: [tradeIds[1], tradeIds[2]], count: 4 })
      })
    })

    describe('and skip goes past the last match', () => {
      beforeEach(async () => {
        await list(`?signer=${signerB}&first=10&skip=10`)
      })

      it('should respond with an empty page and the count of every matching trade', () => {
        expect(body.data).toEqual({ data: [], count: 2 })
      })
    })

    describe('and the signer is not an address', () => {
      beforeEach(async () => {
        await list('?signer=not-an-address')
      })

      it('should respond with a 400 and the invalid parameter', () => {
        expect({ status: response.status, body }).toEqual({
          status: StatusCode.BAD_REQUEST,
          body: { ok: false, message: 'The value of the signer parameter is invalid: not-an-address' }
        })
      })
    })
  })
})
