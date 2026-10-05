import SQL from 'sql-template-strings'
import { getIdentity, getSignedAuthHeaders } from '@dcl/test-helpers'
import { test } from '../components'
import { Identity } from '../utils'
import {
  clearSquidTradesRows,
  createSquidDBNFT,
  createSquidSignatureIndexIncreaseRow,
  createSquidTradeActionRow,
  deleteSquidDBNFT
} from './utils/dbItems'

const PATH = '/v1/cancelled-trades'
const REASON = 'contract_signature_index_bump'
// The pre-V3 Polygon marketplace, which the bump invalidates, and the current one, where trades are re-created.
const BUMPED_MARKETPLACE = '0x540fb08edb56aae562864b390542c97f562825ba'
const CURRENT_MARKETPLACE = '0xe38ef22abe871513555cba89adfe45ab4f548ada'
const NFT_CONTRACT = '0x0000000000000000000000000000000000000abc'
const MANA = '0xa1c57f48f0deb89f569dfbe6e2b7f46d33606fd4'
const OTHER_OWNER = '0x9999999999999999999999999999999999999999'
const DAY = 86_400_000

type TradeFixture = {
  signer: string
  type: 'public_nft_order' | 'bid'
  contract: string
  signature: string
  createdAt: number
  expiresAt?: number
  signerSignatureIndex?: number
}

test('cancelled trades', function ({ components }) {
  let identity: Identity
  let signer: string
  let bumpedAt: number
  let response: Response
  let body: { data?: unknown[]; total?: number; ok?: boolean; message?: string }
  let signatures: string[]

  async function insertTrade(fixture: TradeFixture): Promise<void> {
    const { type, contract, signature, createdAt, expiresAt = Date.now() + DAY, signerSignatureIndex = 0 } = fixture
    const checks = JSON.stringify({
      uses: 1,
      effective: createdAt,
      expiration: expiresAt,
      salt: '0x',
      allowedRoot: '0x',
      externalChecks: [],
      contractSignatureIndex: 0,
      signerSignatureIndex
    })
    const trade = await components.dappsDatabase.query<{ id: string }>(SQL`
      INSERT INTO marketplace.trades
        (signature, hashed_signature, signer, type, network, chain_id, checks, expires_at, effective_since, contract, created_at)
      VALUES (${signature}, ${signature}, ${fixture.signer}, ${type}, 'MATIC', 137, ${checks}::jsonb,
        to_timestamp(${expiresAt}::numeric / 1000), to_timestamp(${createdAt}::numeric / 1000), ${contract},
        to_timestamp(${createdAt}::numeric / 1000))
      RETURNING id
    `)
    const tradeId = trade.rows[0].id
    // Listings send the NFT and receive MANA; bids the other way around.
    const [nftDirection, priceDirection] = type === 'bid' ? ['received', 'sent'] : ['sent', 'received']
    const nft = await components.dappsDatabase.query<{ id: string }>(SQL`
      INSERT INTO marketplace.trade_assets (trade_id, direction, asset_type, contract_address, beneficiary, extra)
      VALUES (${tradeId}, ${nftDirection}, 3, ${NFT_CONTRACT}, ${fixture.signer}, '0x') RETURNING id
    `)
    await components.dappsDatabase.query(SQL`
      INSERT INTO marketplace.trade_assets_erc721 (asset_id, token_id) VALUES (${nft.rows[0].id}, '1')
    `)
    const price = await components.dappsDatabase.query<{ id: string }>(SQL`
      INSERT INTO marketplace.trade_assets (trade_id, direction, asset_type, contract_address, beneficiary, extra)
      VALUES (${tradeId}, ${priceDirection}, 1, ${MANA}, ${fixture.signer}, '0x') RETURNING id
    `)
    await components.dappsDatabase.query(SQL`
      INSERT INTO marketplace.trade_assets_erc20 (asset_id, amount) VALUES (${price.rows[0].id}, '1000')
    `)
    signatures.push(signature)
  }

  async function fetchCancelledTrades(query: string, signed = true): Promise<void> {
    const headers = signed
      ? getSignedAuthHeaders('GET', PATH, { origin: 'https://decentraland.org', signer: 'dcl:marketplace', isGuest: 'false' }, identity)
      : {}
    response = await components.localFetch.fetch(`${PATH}?${query}`, { headers })
    body = await response.json()
  }

  beforeEach(async () => {
    identity = await getIdentity()
    signer = identity.realAccount.address.toLowerCase()
    bumpedAt = Date.now() - 60_000
    signatures = []
    await createSquidDBNFT(components, {
      tokenId: '1',
      contractAddress: NFT_CONTRACT,
      owner: signer,
      name: 'Hat',
      image: 'https://img/hat'
    })
    await insertTrade({
      signer,
      type: 'public_nft_order',
      contract: BUMPED_MARKETPLACE,
      signature: 'cancelled-trades-listing',
      createdAt: Date.now() - DAY
    })
  })

  afterEach(async () => {
    await components.dappsDatabase.query(SQL`DELETE FROM marketplace.trades WHERE signature = ANY(${signatures})`)
    await clearSquidTradesRows(components)
    await deleteSquidDBNFT(components, '1', NFT_CONTRACT)
  })

  describe('when the request is not signed', () => {
    beforeEach(async () => {
      await fetchCancelledTrades(`reason=${REASON}`, false)
    })

    it('should be rejected by the signed fetch middleware with a 400 and an invalid auth chain', () => {
      expect({ status: response.status, body }).toEqual({ status: 400, body: { ok: false, message: 'Invalid Auth Chain' } })
    })
  })

  describe('when the reason is not a known one', () => {
    beforeEach(async () => {
      await fetchCancelledTrades('reason=expired')
    })

    it('should respond with a 400', () => {
      expect(response.status).toBe(400)
    })
  })

  describe('when the marketplace has not bumped its contract signature index', () => {
    beforeEach(async () => {
      await fetchCancelledTrades(`reason=${REASON}`)
    })

    it('should respond with no trades', () => {
      expect(body).toEqual({ data: [], total: 0 })
    })
  })

  describe('when the marketplace bumped its contract signature index', () => {
    beforeEach(async () => {
      await createSquidSignatureIndexIncreaseRow(components, {
        kind: 'contract',
        address: BUMPED_MARKETPLACE,
        contract: BUMPED_MARKETPLACE,
        network: 'POLYGON',
        newValue: 1,
        timestamp: bumpedAt,
        logIndex: 5
      })
    })

    describe('and nothing else happened to the listing', () => {
      beforeEach(async () => {
        await fetchCancelledTrades(`reason=${REASON}`)
      })

      it('should respond with the listing, the bump time, the asset and the price', () => {
        expect(body).toEqual({
          data: [
            expect.objectContaining({
              type: 'public_nft_order',
              network: 'MATIC',
              chainId: 137,
              contract: BUMPED_MARKETPLACE,
              reason: REASON,
              cancelledAt: bumpedAt,
              asset: { contractAddress: NFT_CONTRACT, tokenId: '1', itemId: null, name: 'Hat', image: 'https://img/hat' },
              price: { assetType: 1, amount: '1000' }
            })
          ],
          total: 1
        })
      })
    })

    describe('and the page asked for is past the end', () => {
      beforeEach(async () => {
        await fetchCancelledTrades(`reason=${REASON}&skip=10`)
      })

      it('should still respond with the total', () => {
        expect(body).toEqual({ data: [], total: 1 })
      })
    })

    describe('and the signer cancelled the listing before the bump', () => {
      beforeEach(async () => {
        await createSquidTradeActionRow(components, {
          signature: 'cancelled-trades-listing',
          action: 'cancelled',
          caller: signer,
          network: 'POLYGON',
          timestamp: bumpedAt - 1000
        })
        await fetchCancelledTrades(`reason=${REASON}`)
      })

      it('should respond with no trades', () => {
        expect(body).toEqual({ data: [], total: 0 })
      })
    })

    describe('and the signer cancelled the listing later in the same block', () => {
      beforeEach(async () => {
        await createSquidTradeActionRow(components, {
          signature: 'cancelled-trades-listing',
          action: 'cancelled',
          caller: signer,
          network: 'POLYGON',
          timestamp: bumpedAt,
          logIndex: 6
        })
        await fetchCancelledTrades(`reason=${REASON}`)
      })

      it('should respond with the listing', () => {
        expect(body.total).toBe(1)
      })
    })

    describe('and the signer bumped their own signature index before the bump', () => {
      beforeEach(async () => {
        await createSquidSignatureIndexIncreaseRow(components, {
          kind: 'signer',
          address: signer,
          contract: BUMPED_MARKETPLACE,
          network: 'POLYGON',
          newValue: 1,
          timestamp: bumpedAt - 1000
        })
        await fetchCancelledTrades(`reason=${REASON}`)
      })

      it('should respond with no trades', () => {
        expect(body).toEqual({ data: [], total: 0 })
      })
    })

    describe('and the signer bumped their own signature index after the bump', () => {
      beforeEach(async () => {
        await createSquidSignatureIndexIncreaseRow(components, {
          kind: 'signer',
          address: signer,
          contract: BUMPED_MARKETPLACE,
          network: 'POLYGON',
          newValue: 1,
          timestamp: bumpedAt + 1000
        })
        await fetchCancelledTrades(`reason=${REASON}`)
      })

      it('should respond with the listing', () => {
        expect(body.total).toBe(1)
      })
    })

    describe('and the listing was sold before the bump', () => {
      beforeEach(async () => {
        await createSquidTradeActionRow(components, {
          signature: 'cancelled-trades-listing',
          action: 'executed',
          caller: OTHER_OWNER,
          network: 'POLYGON',
          timestamp: bumpedAt - 1000
        })
        await fetchCancelledTrades(`reason=${REASON}`)
      })

      it('should respond with no trades', () => {
        expect(body).toEqual({ data: [], total: 0 })
      })
    })

    describe('and the listing has expired', () => {
      beforeEach(async () => {
        await components.dappsDatabase.query(
          SQL`UPDATE marketplace.trades SET expires_at = now() - interval '1 minute' WHERE signature = 'cancelled-trades-listing'`
        )
        await fetchCancelledTrades(`reason=${REASON}`)
      })

      it('should respond with no trades', () => {
        expect(body).toEqual({ data: [], total: 0 })
      })
    })

    describe('and the signer re-created the listing on the current marketplace', () => {
      beforeEach(async () => {
        await insertTrade({
          signer,
          type: 'public_nft_order',
          contract: CURRENT_MARKETPLACE,
          signature: 'cancelled-trades-relisting',
          createdAt: Date.now()
        })
        await fetchCancelledTrades(`reason=${REASON}`)
      })

      it('should respond with no trades', () => {
        expect(body).toEqual({ data: [], total: 0 })
      })
    })

    describe('and the signer no longer owns the NFT', () => {
      beforeEach(async () => {
        await components.dappsDatabase.query(
          SQL`UPDATE squid_marketplace.nft SET owner_address = ${OTHER_OWNER} WHERE contract_address = ${NFT_CONTRACT}`
        )
        await fetchCancelledTrades(`reason=${REASON}`)
      })

      it('should respond with no trades', () => {
        expect(body).toEqual({ data: [], total: 0 })
      })
    })

    describe('and the signer also had a bid on an NFT someone else owns', () => {
      beforeEach(async () => {
        await components.dappsDatabase.query(
          SQL`UPDATE squid_marketplace.nft SET owner_address = ${OTHER_OWNER} WHERE contract_address = ${NFT_CONTRACT}`
        )
        await insertTrade({
          signer,
          type: 'bid',
          contract: BUMPED_MARKETPLACE,
          signature: 'cancelled-trades-bid',
          createdAt: Date.now() - DAY
        })
        await fetchCancelledTrades(`reason=${REASON}`)
      })

      it('should respond with the bid, priced by what it offered', () => {
        expect(body).toEqual({
          data: [expect.objectContaining({ type: 'bid', price: { assetType: 1, amount: '1000' } })],
          total: 1
        })
      })
    })

    describe('and the trade was signed by somebody else', () => {
      beforeEach(async () => {
        await components.dappsDatabase.query(
          SQL`UPDATE marketplace.trades SET signer = ${OTHER_OWNER} WHERE signature = 'cancelled-trades-listing'`
        )
        await fetchCancelledTrades(`reason=${REASON}`)
      })

      it('should respond with no trades', () => {
        expect(body).toEqual({ data: [], total: 0 })
      })
    })
  })
})
