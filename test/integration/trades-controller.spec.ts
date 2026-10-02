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
import { createSquidSignatureIndexRow, createSquidTradeActionRow } from './utils/dbItems'

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

  describe('when listing trades with the v2 endpoint', () => {
    type ListedTrade = { id: string; status: string; sent: unknown[]; received: unknown[] } & Record<string, unknown>
    type ListBody = {
      ok: boolean
      message?: string
      data: { results: ListedTrade[]; total: number; page: number; pages: number; limit: number }
    }

    let signerA: string
    let signerB: string
    let marketplaceA: string
    let marketplaceB: string
    let marketplaceC: string
    let tradeIds: string[]
    let signatures: string[]
    let tieCreatedAt: Date
    let response: Response
    let body: ListBody

    const randomAddress = (): string => hexlify(randomBytes(20)).toLowerCase()

    async function insertTrade(options: {
      signer: string
      marketplaceAddress: string
      createdAt: Date
      expiresInHours?: number
    }): Promise<{ id: string; hashedSignature: string }> {
      const signature = hexlify(randomBytes(65))
      const hashedSignature = hexlify(randomBytes(32))
      const checks = { uses: 1, signerSignatureIndex: 0, contractSignatureIndex: 0 }
      const result = await components.dappsDatabase.query<{ id: string }>(SQL`
        INSERT INTO marketplace.trades (signature, hashed_signature, signer, type, network, chain_id, checks, expires_at, effective_since, contract, created_at)
        VALUES (${signature}, ${hashedSignature}, ${options.signer}, ${TradeType.BID}, ${Network.ETHEREUM}, 1, ${checks},
          NOW() + (${options.expiresInHours ?? 24} * INTERVAL '1 hour'), NOW(), ${options.marketplaceAddress}, ${options.createdAt})
        RETURNING id`)
      return { id: result.rows[0].id, hashedSignature }
    }

    async function list(path: string): Promise<void> {
      response = await components.localFetch.fetch(path)
      body = await response.json()
    }

    const ids = (): string[] => body.data.results.map(trade => trade.id)
    const hoursAgo = (hours: number): Date => new Date(Date.now() - hours * 60 * 60 * 1000)

    beforeEach(async () => {
      signerA = randomAddress()
      signerB = randomAddress()
      marketplaceA = randomAddress()
      marketplaceB = randomAddress()
      marketplaceC = randomAddress()
      tieCreatedAt = hoursAgo(4)
      // Newest first. The first trade stores its marketplace address checksummed; the last two share a creation date.
      const inserted = [
        await insertTrade({ signer: signerA, marketplaceAddress: getAddress(marketplaceA), createdAt: hoursAgo(1) }),
        await insertTrade({ signer: signerA, marketplaceAddress: marketplaceB, createdAt: hoursAgo(2) }),
        await insertTrade({ signer: signerB, marketplaceAddress: marketplaceA, createdAt: hoursAgo(3), expiresInHours: -1 }),
        await insertTrade({ signer: signerB, marketplaceAddress: marketplaceC, createdAt: tieCreatedAt }),
        await insertTrade({ signer: signerB, marketplaceAddress: marketplaceC, createdAt: tieCreatedAt })
      ]
      const [tieLow, tieHigh] = [inserted[3], inserted[4]].sort((a, b) => a.id.localeCompare(b.id))
      inserted[3] = tieLow
      inserted[4] = tieHigh
      tradeIds = inserted.map(trade => trade.id)
      signatures = inserted.map(trade => trade.hashedSignature)

      // trade 0 is sold, trade 1 cancelled by its signer, trade 2 expired, trades 3 and 4 open.
      await createSquidTradeActionRow(components, {
        signature: signatures[0],
        action: 'executed',
        caller: randomAddress(),
        network: 'ETHEREUM'
      })
      await createSquidTradeActionRow(components, { signature: signatures[1], action: 'cancelled', caller: signerA, network: 'ETHEREUM' })

      const asset = await components.dappsDatabase.query<{ id: string }>(SQL`
        INSERT INTO marketplace.trade_assets (asset_type, beneficiary, contract_address, direction, extra, trade_id)
        VALUES (${TradeAssetType.ERC721}, NULL, ${marketplaceC}, ${TradeAssetDirection.SENT}, '0x', ${tradeIds[0]}) RETURNING id`)
      await components.dappsDatabase.query(
        SQL`INSERT INTO marketplace.trade_assets_erc721 (asset_id, token_id) VALUES (${asset.rows[0].id}, '42')`
      )
      const price = await components.dappsDatabase.query<{ id: string }>(SQL`
        INSERT INTO marketplace.trade_assets (asset_type, beneficiary, contract_address, direction, extra, trade_id)
        VALUES (${TradeAssetType.ERC20}, ${signerA}, ${MANA_MAINNET_ADDRESS}, ${TradeAssetDirection.RECEIVED}, '0x', ${tradeIds[0]}) RETURNING id`)
      await components.dappsDatabase.query(
        SQL`INSERT INTO marketplace.trade_assets_erc20 (asset_id, amount) VALUES (${price.rows[0].id}, '1000')`
      )
    })

    afterEach(async () => {
      await components.dappsDatabase.query(SQL`DELETE FROM squid_trades.trade WHERE signature = ANY(${signatures})`)
      await components.dappsDatabase.query(SQL`DELETE FROM marketplace.trades WHERE id = ANY(${tradeIds})`)
    })

    describe('and no signer is given', () => {
      beforeEach(async () => {
        await list(`/v2/trades?marketplace_address=${marketplaceA}`)
      })

      it('should respond with a 400 and the missing parameter', () => {
        expect({ status: response.status, body }).toEqual({
          status: StatusCode.BAD_REQUEST,
          body: { ok: false, message: 'The signer parameter is required' }
        })
      })
    })

    describe('and a signer is given', () => {
      beforeEach(async () => {
        await list(`/v2/trades?signer=${getAddress(signerA)}`)
      })

      it("should respond with the signer's trades as API trades with their assets and status, newest first", () => {
        expect(body).toEqual({
          ok: true,
          data: {
            results: [
              {
                id: tradeIds[0],
                signer: signerA,
                signature: expect.any(String),
                type: TradeType.BID,
                network: Network.ETHEREUM,
                chainId: 1,
                checks: { uses: 1, signerSignatureIndex: 0, contractSignatureIndex: 0 },
                createdAt: expect.any(Number),
                sent: [{ assetType: TradeAssetType.ERC721, contractAddress: marketplaceC, extra: '0x', tokenId: '42' }],
                received: [
                  {
                    assetType: TradeAssetType.ERC20,
                    contractAddress: MANA_MAINNET_ADDRESS,
                    extra: '0x',
                    amount: '1000',
                    beneficiary: signerA
                  }
                ],
                contract: getAddress(marketplaceA),
                status: 'sold'
              },
              expect.objectContaining({ id: tradeIds[1], sent: [], received: [], status: 'cancelled' })
            ],
            total: 2,
            page: 0,
            pages: 1,
            limit: 100
          }
        })
      })
    })

    describe('and a marketplace address is given', () => {
      beforeEach(async () => {
        await list(`/v2/trades?signer=${signerA}&marketplace_address=${marketplaceA}`)
      })

      it("should respond with the signer's trades signed for that marketplace regardless of the stored casing", () => {
        expect({ ids: ids(), total: body.data.total }).toEqual({ ids: [tradeIds[0]], total: 1 })
      })
    })

    describe('and several marketplace addresses are given', () => {
      beforeEach(async () => {
        await list(`/v2/trades?signer=${signerA}&marketplace_address=${marketplaceA}&marketplace_address=${getAddress(marketplaceB)}`)
      })

      it("should respond with the signer's trades signed for any of those marketplaces", () => {
        expect({ ids: ids(), total: body.data.total }).toEqual({ ids: [tradeIds[0], tradeIds[1]], total: 2 })
      })
    })

    describe('and a marketplace address the signer has no trades for is given', () => {
      beforeEach(async () => {
        await list(`/v2/trades?signer=${signerA}&marketplace_address=${marketplaceC}`)
      })

      it('should respond with no trades', () => {
        expect({ ids: ids(), total: body.data.total }).toEqual({ ids: [], total: 0 })
      })
    })

    describe.each([
      ['open', 'second', () => signerB, () => [tradeIds[3], tradeIds[4]]],
      ['sold', 'first', () => signerA, () => [tradeIds[0]]],
      ['cancelled', 'first', () => signerA, () => [tradeIds[1]]],
      ['cancelled', 'second', () => signerB, () => [tradeIds[2]]]
    ])('and the %s status is given for the %s signer', (status, _signerName, signer, expectedIds) => {
      beforeEach(async () => {
        await list(`/v2/trades?signer=${signer()}&status=${status}`)
      })

      it(`should respond with the ${status} trades only and their total`, () => {
        expect({ ids: ids(), total: body.data.total, statuses: [...new Set(body.data.results.map(trade => trade.status))] }).toEqual({
          ids: expectedIds(),
          total: expectedIds().length,
          statuses: [status]
        })
      })
    })

    describe('and the signer bumped their signature index on a marketplace', () => {
      beforeEach(async () => {
        await createSquidSignatureIndexRow(components, { address: signerB, contract: marketplaceC, network: 'ETHEREUM', index: 1 })
        await list(`/v2/trades?signer=${signerB}&status=cancelled`)
      })

      afterEach(async () => {
        await components.dappsDatabase.query(SQL`DELETE FROM squid_trades.signature_index WHERE address = ${signerB}`)
      })

      it("should report the signer's trades on that marketplace as cancelled", () => {
        expect(ids()).toEqual([tradeIds[2], tradeIds[3], tradeIds[4]])
      })
    })

    describe('and several statuses are given', () => {
      beforeEach(async () => {
        await list(`/v2/trades?signer=${signerB}&status=open&status=cancelled`)
      })

      it('should respond with the trades in any of those statuses', () => {
        expect({ ids: ids(), total: body.data.total }).toEqual({ ids: [tradeIds[2], tradeIds[3], tradeIds[4]], total: 3 })
      })
    })

    describe('and trades share a creation date', () => {
      beforeEach(async () => {
        await list(`/v2/trades?signer=${signerB}&marketplace_address=${marketplaceC}`)
      })

      it('should order them by id', () => {
        expect(ids()).toEqual([tradeIds[3], tradeIds[4]])
      })
    })

    describe('and a limit and an offset are given', () => {
      beforeEach(async () => {
        await list(`/v2/trades?signer=${signerB}&limit=1&offset=1`)
      })

      it('should respond with that page and the pagination of every matching trade', () => {
        expect({ ids: ids(), total: body.data.total, page: body.data.page, pages: body.data.pages, limit: body.data.limit }).toEqual({
          ids: [tradeIds[3]],
          total: 3,
          page: 1,
          pages: 3,
          limit: 1
        })
      })
    })

    describe('and a page is given', () => {
      beforeEach(async () => {
        await list(`/v2/trades?signer=${signerB}&limit=2&page=1`)
      })

      it('should respond with the trades of that zero-based page', () => {
        expect({ ids: ids(), page: body.data.page, pages: body.data.pages }).toEqual({ ids: [tradeIds[4]], page: 1, pages: 2 })
      })
    })

    describe('and the offset goes past the last match', () => {
      beforeEach(async () => {
        await list(`/v2/trades?signer=${signerB}&limit=10&offset=10`)
      })

      it('should respond with an empty page and the pagination of every matching trade', () => {
        expect(body.data).toEqual({ results: [], total: 3, page: 1, pages: 1, limit: 10 })
      })
    })

    describe('and the limit is above the maximum', () => {
      beforeEach(async () => {
        await list(`/v2/trades?signer=${signerB}&limit=1000`)
      })

      it('should cap the limit at 100', () => {
        expect(body.data.limit).toBe(100)
      })
    })

    describe.each([
      ['the signer is not an address', 'signer=not-an-address', 'The value of the signer parameter is invalid: not-an-address'],
      [
        'a marketplace address is not an address',
        'marketplace_address=0x1&marketplace_address=not-an-address',
        'The value of the marketplace_address parameter is invalid: 0x1'
      ],
      ['the status is unknown', 'status=expired', 'The value of the status parameter is invalid: expired'],
      ['the limit is not a number', 'limit=ten', 'The value of the limit parameter is invalid: ten'],
      ['the offset is negative', 'offset=-1', 'The value of the offset parameter is invalid: -1']
    ])('and %s', (_description, query, message) => {
      beforeEach(async () => {
        await list(query.startsWith('signer=') ? `/v2/trades?${query}` : `/v2/trades?signer=${signerA}&${query}`)
      })

      it('should respond with a 400 and the invalid parameter', () => {
        expect({ status: response.status, body }).toEqual({ status: StatusCode.BAD_REQUEST, body: { ok: false, message } })
      })
    })

    describe('and the v1 endpoint is called with the same filters', () => {
      let v1Body: { ok: boolean; data: { data: { id: string }[]; count: number } }
      let total: number

      beforeEach(async () => {
        const countResult = await components.dappsDatabase.query<{ count: number }>(
          SQL`SELECT COUNT(*)::int AS count FROM marketplace.trades`
        )
        total = countResult.rows[0].count
        const v1Response = await components.localFetch.fetch(`/v1/trades?signer=${signerA}&marketplace_address=${marketplaceA}&limit=1`)
        v1Body = await v1Response.json()
      })

      it('should keep returning every stored trade with its count', () => {
        expect({ length: v1Body.data.data.length, count: v1Body.data.count }).toEqual({ length: total, count: total })
      })
    })
  })
})
