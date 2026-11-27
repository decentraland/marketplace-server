import SQL from 'sql-template-strings'
import { ChainId, ListingStatus, NFTCategory } from '@dcl/schemas'
import * as chainIdUtils from '../../src/logic/chainIds'
import { BaseComponents } from '../../src/types'
import { test } from '../components'
import {
  clearSquidTradesRows,
  createSquidDBBidTrade,
  createSquidDBItem,
  createSquidDBLegacyBid,
  createSquidDBNFT,
  createSquidSignatureIndexRow,
  createSquidTradeActionRow,
  deleteSquidDBItem,
  deleteSquidDBLegacyBid,
  deleteSquidDBNFT,
  deleteSquidDBTrade,
  refreshTradesMaterializedView
} from './utils/dbItems'

type Row = Record<string, unknown>
type NFTRow = { nft: { tokenId: string }; order: Row | null }

// The column default on marketplace.trades, which every trade below targets.
const MARKETPLACE = '0x540fb08eDb56AaE562864B390542C97F562825BA'

/**
 * An open order on Polygon: a primary item order priced in USD-pegged MANA when `itemId` is given, otherwise a
 * secondary nft order priced in MANA.
 */
async function createOpenOrder(
  components: Pick<BaseComponents, 'dappsDatabase'>,
  options: { contractAddress: string; signer: string; signature: string; itemId?: string; tokenId?: string }
): Promise<string> {
  const { contractAddress, signer, signature, itemId, tokenId } = options
  const checks = {
    uses: 10,
    effective: Date.now(),
    expiration: Date.now() + 86400000,
    allowedRoot: '0x',
    contractSignatureIndex: 0,
    signerSignatureIndex: 0,
    externalChecks: [],
    salt: '0x'
  }
  const client = await components.dappsDatabase.getPool().connect()
  try {
    const trade = await client.query<{ id: string }>(SQL`
      INSERT INTO marketplace.trades (signature, hashed_signature, signer, type, network, chain_id, checks, expires_at, effective_since)
      VALUES (${signature}, ${signature}, ${signer.toLowerCase()}, ${itemId ? 'public_item_order' : 'public_nft_order'}, 'MATIC', 80002,
        ${JSON.stringify(checks)}, NOW() + INTERVAL '1 day', NOW())
      RETURNING id
    `)
    const tradeId = trade.rows[0].id
    const sent = await client.query<{ id: string }>(SQL`
      INSERT INTO marketplace.trade_assets (trade_id, direction, asset_type, contract_address, beneficiary, extra)
      VALUES (${tradeId}, 'sent', ${itemId ? 4 : 3}, ${contractAddress.toLowerCase()}, ${itemId ? null : signer.toLowerCase()}, '0x')
      RETURNING id
    `)
    if (itemId) {
      await client.query(SQL`INSERT INTO marketplace.trade_assets_item (asset_id, item_id) VALUES (${sent.rows[0].id}, ${itemId})`)
    } else {
      await client.query(SQL`INSERT INTO marketplace.trade_assets_erc721 (asset_id, token_id) VALUES (${sent.rows[0].id}, ${tokenId})`)
    }
    const received = await client.query<{ id: string }>(SQL`
      INSERT INTO marketplace.trade_assets (trade_id, direction, asset_type, contract_address, beneficiary, extra)
      VALUES (${tradeId}, 'received', ${itemId ? 2 : 1}, '0x9d32aac179153a991e832550d9f96441ea27763a', ${signer.toLowerCase()}, '0x')
      RETURNING id
    `)
    await client.query(
      SQL`INSERT INTO marketplace.trade_assets_erc20 (asset_id, amount) VALUES (${received.rows[0].id}, '500000000000000000')`
    )
    return tradeId
  } finally {
    client.release()
  }
}

/**
 * A marketplace bumping its own contractSignatureIndex invalidates every trade signed against the old value,
 * so those trades must leave every open list exactly like a signer cancellation does.
 */
test('contract signature index bump', function ({ components }) {
  const SELLER = '0x5e11e5000000000000000000000000000000beef'

  let tradeId: string

  beforeEach(() => {
    jest.spyOn(chainIdUtils, 'getEthereumChainId').mockReturnValue(ChainId.ETHEREUM_SEPOLIA)
    jest.spyOn(chainIdUtils, 'getPolygonChainId').mockReturnValue(ChainId.MATIC_AMOY)
  })

  afterEach(async () => {
    await clearSquidTradesRows(components)
    await deleteSquidDBTrade(components, tradeId)
  })

  async function getJSON<T = { data: Row[] }>(path: string): Promise<T> {
    const response = await components.localFetch.fetch(path)
    expect(response.status).toBe(200)
    return (await response.json()) as T
  }

  async function bumpContractSignatureIndex(): Promise<void> {
    await createSquidSignatureIndexRow(components, { address: MARKETPLACE, contract: MARKETPLACE, network: 'POLYGON', index: 1 })
  }

  describe('when an item has an open primary listing', () => {
    const COLLECTION = '0xa11ce00000000000000000000000000000000011'
    const ITEM_ID = '7'

    beforeEach(async () => {
      await createSquidDBItem(components, {
        itemId: ITEM_ID,
        contractAddress: COLLECTION,
        isMarketplaceV3MinterSet: true,
        available: 5,
        collectionApproved: true
      })
      tradeId = await createOpenOrder(components, {
        contractAddress: COLLECTION,
        itemId: ITEM_ID,
        signer: SELLER,
        signature: `index-bump-item-${Date.now()}-${Math.random()}`
      })
    })

    afterEach(async () => {
      // deleteSquidDBTrade does not clear item assets, which would block deleting the trade.
      await components.dappsDatabase.query(SQL`
        DELETE FROM marketplace.trade_assets_item
        WHERE asset_id IN (SELECT id FROM marketplace.trade_assets WHERE trade_id = ${tradeId})
      `)
      await deleteSquidDBItem(components, ITEM_ID, COLLECTION)
    })

    describe('and nothing invalidated it', () => {
      let item: Row | undefined

      beforeEach(async () => {
        await refreshTradesMaterializedView(components)
        item = (await getJSON(`/v1/items?contractAddress=${COLLECTION}&itemId=${ITEM_ID}`)).data[0]
      })

      it('should put the item on sale through the trade', () => {
        expect(item).toMatchObject({ tradeId, isOnSale: true, price: '500000000000000000' })
      })
    })

    describe('and its marketplace contract bumps its contract signature index', () => {
      beforeEach(async () => {
        await bumpContractSignatureIndex()
        await refreshTradesMaterializedView(components)
      })

      describe('and fetching it from /v1/items', () => {
        let item: Row | undefined

        beforeEach(async () => {
          item = (await getJSON(`/v1/items?contractAddress=${COLLECTION}&itemId=${ITEM_ID}`)).data[0]
        })

        it('should no longer surface the trade nor put the item on sale', () => {
          expect(item).toMatchObject({ tradeId: null, isOnSale: false, price: '0' })
        })
      })

      describe('and fetching it from /v2/catalog', () => {
        let item: Row | undefined

        beforeEach(async () => {
          item = (await getJSON(`/v2/catalog?contractAddress=${COLLECTION}`)).data.find((row: Row) => row.itemId === ITEM_ID)
        })

        // The catalogue omits tradeId unless a trade sets the price.
        it('should no longer put the item on sale nor surface the trade', () => {
          expect(item).toEqual(expect.objectContaining({ isOnSale: false, price: '0' }))
          expect(item).not.toHaveProperty('tradeId')
        })
      })

      describe('and fetching it from /v3/catalog/shop', () => {
        let tradeIds: string[]

        beforeEach(async () => {
          tradeIds = (await getJSON(`/v3/catalog/shop?contractAddress=${COLLECTION}`)).data.map((row: Row) => row.tradeId as string)
        })

        it('should drop the listing from the feed', () => {
          expect(tradeIds).not.toContain(tradeId)
        })
      })
    })
  })

  describe('when an nft has an open secondary listing', () => {
    const COLLECTION = '0xb0b0000000000000000000000000000000000012'
    let tokenId: string
    let signature: string

    beforeEach(async () => {
      tokenId = `${Date.now()}`
      signature = `index-bump-nft-${tokenId}`
      await createSquidDBNFT(components, { tokenId, contractAddress: COLLECTION, owner: SELLER, category: NFTCategory.WEARABLE })
      tradeId = await createOpenOrder(components, { contractAddress: COLLECTION, tokenId, signer: SELLER, signature })
    })

    afterEach(async () => {
      await deleteSquidDBNFT(components, tokenId, COLLECTION)
    })

    describe('and nothing invalidated it', () => {
      let tradeIds: string[]

      beforeEach(async () => {
        await refreshTradesMaterializedView(components)
        tradeIds = (await getJSON(`/v1/orders?contractAddress=${COLLECTION}&tokenId=${tokenId}&status=open`)).data.map(
          (row: Row) => row.tradeId as string
        )
      })

      it('should list it among the open orders', () => {
        expect(tradeIds).toContain(tradeId)
      })
    })

    describe('and the signer cancelled it', () => {
      let tradeIds: string[]

      beforeEach(async () => {
        await createSquidTradeActionRow(components, { signature, action: 'cancelled', caller: SELLER, network: 'POLYGON' })
        await refreshTradesMaterializedView(components)
        tradeIds = (await getJSON(`/v1/orders?contractAddress=${COLLECTION}&tokenId=${tokenId}&status=open`)).data.map(
          (row: Row) => row.tradeId as string
        )
      })

      it('should drop it from the open orders', () => {
        expect(tradeIds).not.toContain(tradeId)
      })
    })

    // Must behave exactly like the signer cancellation above.
    describe('and its marketplace contract bumps its contract signature index', () => {
      let tradeIds: string[]
      let embeddedOrder: unknown

      beforeEach(async () => {
        await bumpContractSignatureIndex()
        await refreshTradesMaterializedView(components)
        tradeIds = (await getJSON(`/v1/orders?contractAddress=${COLLECTION}&tokenId=${tokenId}&status=open`)).data.map(
          (row: Row) => row.tradeId as string
        )
        const nfts = (await getJSON<{ data: NFTRow[] }>(`/v1/nfts?contractAddress=${COLLECTION}&tokenId=${tokenId}`)).data
        embeddedOrder = nfts.find(row => row.nft.tokenId === tokenId)?.order
      })

      it('should drop it from the open orders', () => {
        expect(tradeIds).not.toContain(tradeId)
      })

      it('should no longer embed it as the nft order', () => {
        expect(embeddedOrder).toBeNull()
      })
    })
  })

  describe('when an nft has an off-chain bid and a legacy on-chain bid', () => {
    const CONTRACT_ADDRESS = '0x7777000000000000000000000000000000000011'
    const TOKEN_ID = '991'
    const OWNER_HEX = '8888000000000000000000000000000000000011'
    const OWNER = `0x${OWNER_HEX}`
    const TRADE_BIDDER = '0x9999000000000000000000000000000000000011'
    let legacyBidId: string
    let bids: { id: string; tradeId?: string; status: ListingStatus }[]

    async function fetchBids(query: string): Promise<typeof bids> {
      return (await getJSON<{ data: { results: typeof bids } }>(`/v1/bids?${query}&limit=10&offset=0`)).data.results
    }

    beforeEach(async () => {
      await createSquidDBNFT(components, { contractAddress: CONTRACT_ADDRESS, tokenId: TOKEN_ID, owner: OWNER, network: 'matic' })
      tradeId = await createSquidDBBidTrade(components, {
        contractAddress: CONTRACT_ADDRESS,
        tokenId: TOKEN_ID,
        bidder: TRADE_BIDDER,
        network: 'MATIC'
      })
      legacyBidId = await createSquidDBLegacyBid(components, {
        contractAddress: CONTRACT_ADDRESS,
        tokenId: TOKEN_ID,
        bidder: 'aaaa000000000000000000000000000000000012',
        seller: OWNER_HEX,
        status: 'open'
      })
    })

    afterEach(async () => {
      await deleteSquidDBLegacyBid(components, legacyBidId)
      await deleteSquidDBNFT(components, TOKEN_ID, CONTRACT_ADDRESS)
    })

    describe('and the marketplace the off-chain bid targets bumps its contract signature index', () => {
      beforeEach(async () => {
        await bumpContractSignatureIndex()
      })

      describe('and filtering the open bids by the owner as seller', () => {
        beforeEach(async () => {
          bids = await fetchBids(`seller=${OWNER}&status=${ListingStatus.OPEN}`)
        })

        it('should leave out the off-chain bid and keep the legacy one', () => {
          expect(bids.map(bid => bid.tradeId ?? bid.id)).toEqual([legacyBidId])
        })
      })

      describe('and filtering the open bids by the bidder', () => {
        beforeEach(async () => {
          bids = await fetchBids(`bidder=${TRADE_BIDDER}&status=${ListingStatus.OPEN}`)
        })

        it('should leave out the off-chain bid', () => {
          expect(bids).toEqual([])
        })
      })

      describe('and filtering the bids by the bidder without a status', () => {
        beforeEach(async () => {
          bids = await fetchBids(`bidder=${TRADE_BIDDER}`)
        })

        it('should report the off-chain bid as cancelled', () => {
          expect(bids).toEqual([expect.objectContaining({ tradeId, status: ListingStatus.CANCELLED })])
        })
      })
    })
  })
})
