import { ChainId, NFTCategory } from '@dcl/schemas'
import * as chainIdUtils from '../../src/logic/chainIds'
import { test } from '../components'
import {
  clearSquidTradesRows,
  createSquidContractStatusRow,
  createSquidDBItem,
  createSquidDBNFT,
  createSquidDBTrade,
  deleteSquidDBItem,
  deleteSquidDBNFT,
  deleteSquidDBTrade,
  refreshTradesMaterializedView
} from './utils/dbItems'

/**
 * A paused off-chain marketplace contract, read from the trades indexer's contract_status into an in-app cache.
 *
 * Product decision: a listing on a paused contract stays OPEN and visible everywhere, and keeps counting in
 * the catalogue aggregates; every representation only says so through `isPaused`. When an item has more than one
 * open order, an unpaused one represents it, then the newest.
 */
type Row = Record<string, unknown>
type NFTRow = { nft: { tokenId: string }; order: Row | null }

test('paused marketplace contracts', function ({ components }) {
  // OffChainMarketplaceV3 on Amoy, lowercase as the indexer writes it.
  const MARKETPLACE = '0x36fd1434a6c4b8ade80c9847c1d15033ce34488c'
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

  describe('when an item has an open primary listing', () => {
    const COLLECTION = '0xa11ce00000000000000000000000000000000001'
    const ITEM_ID = '7'

    beforeEach(async () => {
      await createSquidDBItem(components, {
        itemId: ITEM_ID,
        contractAddress: COLLECTION,
        isMarketplaceV3MinterSet: true,
        available: 5,
        collectionApproved: true
      })
      tradeId = await createSquidDBTrade(components, {
        contractAddress: COLLECTION,
        itemId: ITEM_ID,
        owner: SELLER,
        marketplace: MARKETPLACE,
        network: 'MATIC',
        price: '500000000000000000',
        priceAssetType: 2,
        uses: 10
      })
    })

    afterEach(async () => {
      await deleteSquidDBItem(components, ITEM_ID, COLLECTION)
    })

    describe('and its marketplace contract is paused', () => {
      beforeEach(async () => {
        // POLYGON, not MATIC: proves the network translation the cache applies.
        await createSquidContractStatusRow(components, { address: MARKETPLACE, network: 'POLYGON', paused: true })
        await refreshTradesMaterializedView(components)
      })

      describe('and fetching it from /v1/items', () => {
        let item: Row | undefined

        beforeEach(async () => {
          item = (await getJSON(`/v1/items?contractAddress=${COLLECTION}&itemId=${ITEM_ID}`)).data[0]
        })

        it('should keep it on sale through the trade and flag it as paused', () => {
          expect(item).toMatchObject({ tradeId, tradeContractAddress: MARKETPLACE, isOnSale: true, isPaused: true })
        })
      })

      describe('and fetching it from /v2/catalog', () => {
        let item: Row | undefined

        beforeEach(async () => {
          item = (await getJSON(`/v2/catalog?contractAddress=${COLLECTION}`)).data.find((row: Row) => row.itemId === ITEM_ID)
        })

        it('should keep it on sale priced by the trade and flag it as paused', () => {
          expect(item).toMatchObject({ tradeId, isOnSale: true, price: '500000000000000000', isPaused: true })
        })
      })

      describe('and fetching it from /v3/catalog/items', () => {
        let item: Row | undefined

        beforeEach(async () => {
          item = (await getJSON(`/v3/catalog/items?contractAddress=${COLLECTION}`)).data.find((row: Row) => row.itemId === ITEM_ID)
        })

        it('should flag it as paused', () => {
          expect(item).toMatchObject({ tradeId, isPaused: true })
        })
      })

      describe('and fetching it from /v3/catalog/shop', () => {
        let listing: Row | undefined

        beforeEach(async () => {
          listing = (await getJSON(`/v3/catalog/shop?contractAddress=${COLLECTION}`)).data.find((row: Row) => row.tradeId === tradeId)
        })

        it('should keep the listing in the feed and flag it as paused', () => {
          expect(listing).toMatchObject({ tradeId, priceCredits: 5, isPaused: true })
        })
      })

      describe('and fetching it from /v3/catalog/unified', () => {
        let listing: Row | undefined

        beforeEach(async () => {
          listing = (await getJSON(`/v3/catalog/unified?source=native&contractAddress=${COLLECTION}`)).data.find(
            (row: Row) => row.tradeId === tradeId
          )
        })

        it('should keep the listing in the feed and flag it as paused', () => {
          expect(listing).toMatchObject({ tradeId, source: 'native', isPaused: true })
        })
      })

      describe('and fetching it from /v3/catalog/unified grouped by item', () => {
        let item: Row | undefined

        beforeEach(async () => {
          item = (await getJSON(`/v3/catalog/unified?groupBy=item&source=native&contractAddress=${COLLECTION}`)).data.find(
            (row: Row) => row.itemId === ITEM_ID
          )
        })

        it('should keep the item in the feed and flag its representative listing as paused', () => {
          expect(item).toMatchObject({ tradeId, listingCount: 1, isPaused: true })
        })
      })

      describe('and fetching the trade from /v1/trades/:id', () => {
        let trade: Row | undefined

        beforeEach(async () => {
          trade = (await getJSON<{ data: Row }>(`/v1/trades/${tradeId}`)).data
        })

        it('should report it open and paused', () => {
          expect(trade).toMatchObject({ id: tradeId, status: 'open', isPaused: true })
        })
      })

      describe('and listing every trade from /v1/trades', () => {
        let trade: Row | undefined

        beforeEach(async () => {
          trade = (await getJSON<{ data: { data: Row[] } }>('/v1/trades')).data.data.find((row: Row) => row.id === tradeId)
        })

        // The raw rows keep the snake_case column name.
        it('should flag the raw row as paused', () => {
          expect(trade).toMatchObject({ id: tradeId, paused: true })
        })
      })
    })

    describe.each([
      ['its marketplace contract was unpaused', { network: 'POLYGON', paused: false }],
      ['the same contract is paused on another network only', { network: 'ETHEREUM', paused: true }]
    ])('and %s', (_name, status) => {
      beforeEach(async () => {
        await createSquidContractStatusRow(components, { address: MARKETPLACE, ...status })
        await refreshTradesMaterializedView(components)
      })

      describe('and fetching it from /v1/items', () => {
        let item: Row | undefined

        beforeEach(async () => {
          item = (await getJSON(`/v1/items?contractAddress=${COLLECTION}&itemId=${ITEM_ID}`)).data[0]
        })

        it('should not flag it as paused', () => {
          expect(item).toMatchObject({ tradeId, isOnSale: true, isPaused: false })
        })
      })

      describe('and fetching it from /v2/catalog', () => {
        let item: Row | undefined

        beforeEach(async () => {
          item = (await getJSON(`/v2/catalog?contractAddress=${COLLECTION}`)).data.find((row: Row) => row.itemId === ITEM_ID)
        })

        it('should not flag it as paused', () => {
          expect(item).toMatchObject({ tradeId, isPaused: false })
        })
      })
    })
  })

  describe('when an item has an open order on a paused marketplace and another on a live one', () => {
    const COLLECTION = '0xa11ce00000000000000000000000000000000002'
    const ITEM_ID = '8'
    const LIVE_MARKETPLACE = '0x1e0000000000000000000000000000000000ce03'
    // The paused order is the newest and has the greater id, so only the paused flag can rank it last.
    const PAUSED_TRADE_ID = 'ffffffff-ffff-4fff-bfff-ffffffffffff'
    const LIVE_TRADE_ID = '00000000-0000-4000-8000-000000000001'
    const LIVE_PRICE = '700000000000000000'

    beforeEach(async () => {
      await createSquidDBItem(components, {
        itemId: ITEM_ID,
        contractAddress: COLLECTION,
        isMarketplaceV3MinterSet: true,
        available: 5,
        collectionApproved: true
      })
      tradeId = await createSquidDBTrade(components, {
        id: PAUSED_TRADE_ID,
        contractAddress: COLLECTION,
        itemId: ITEM_ID,
        owner: SELLER,
        marketplace: MARKETPLACE,
        network: 'MATIC',
        price: '900000000000000000',
        priceAssetType: 2,
        uses: 10,
        createdAt: new Date('2026-02-01T00:00:00.000Z')
      })
      await createSquidDBTrade(components, {
        id: LIVE_TRADE_ID,
        contractAddress: COLLECTION,
        itemId: ITEM_ID,
        owner: SELLER,
        marketplace: LIVE_MARKETPLACE,
        network: 'MATIC',
        price: LIVE_PRICE,
        priceAssetType: 2,
        uses: 10,
        createdAt: new Date('2026-01-01T00:00:00.000Z')
      })
      await createSquidContractStatusRow(components, { address: MARKETPLACE, network: 'POLYGON', paused: true })
      await refreshTradesMaterializedView(components)
    })

    afterEach(async () => {
      await deleteSquidDBTrade(components, LIVE_TRADE_ID)
      await deleteSquidDBItem(components, ITEM_ID, COLLECTION)
    })

    describe('and fetching it from /v1/items', () => {
      let item: Row | undefined

      beforeEach(async () => {
        item = (await getJSON(`/v1/items?contractAddress=${COLLECTION}&itemId=${ITEM_ID}`)).data[0]
      })

      it('should surface the live order with its price and not flag it as paused', () => {
        expect(item).toMatchObject({ tradeId: LIVE_TRADE_ID, tradeContractAddress: LIVE_MARKETPLACE, price: LIVE_PRICE, isPaused: false })
      })
    })

    describe('and fetching it from /v2/catalog', () => {
      let item: Row | undefined

      beforeEach(async () => {
        item = (await getJSON(`/v2/catalog?contractAddress=${COLLECTION}`)).data.find((row: Row) => row.itemId === ITEM_ID)
      })

      it('should surface the live order with its price and not flag it as paused', () => {
        expect(item).toMatchObject({ tradeId: LIVE_TRADE_ID, price: LIVE_PRICE, isPaused: false })
      })
    })
  })

  describe('when an item has two open orders on live marketplaces', () => {
    const COLLECTION = '0xa11ce00000000000000000000000000000000003'
    const ITEM_ID = '9'
    // The older order has the greater id, so picking by id alone would surface it.
    const OLDER_TRADE_ID = 'ffffffff-ffff-4fff-bfff-fffffffffffe'
    const NEWER_TRADE_ID = '00000000-0000-4000-8000-000000000002'
    const NEWER_PRICE = '600000000000000000'

    beforeEach(async () => {
      await createSquidDBItem(components, {
        itemId: ITEM_ID,
        contractAddress: COLLECTION,
        isMarketplaceV3MinterSet: true,
        available: 5,
        collectionApproved: true
      })
      tradeId = await createSquidDBTrade(components, {
        id: OLDER_TRADE_ID,
        contractAddress: COLLECTION,
        itemId: ITEM_ID,
        owner: SELLER,
        marketplace: MARKETPLACE,
        network: 'MATIC',
        price: '800000000000000000',
        priceAssetType: 2,
        uses: 10,
        createdAt: new Date('2026-01-01T00:00:00.000Z')
      })
      await createSquidDBTrade(components, {
        id: NEWER_TRADE_ID,
        contractAddress: COLLECTION,
        itemId: ITEM_ID,
        owner: SELLER,
        marketplace: MARKETPLACE,
        network: 'MATIC',
        price: NEWER_PRICE,
        priceAssetType: 2,
        uses: 10,
        createdAt: new Date('2026-02-01T00:00:00.000Z')
      })
      await refreshTradesMaterializedView(components)
    })

    afterEach(async () => {
      await deleteSquidDBTrade(components, NEWER_TRADE_ID)
      await deleteSquidDBItem(components, ITEM_ID, COLLECTION)
    })

    describe('and fetching it from /v1/items', () => {
      let item: Row | undefined

      beforeEach(async () => {
        item = (await getJSON(`/v1/items?contractAddress=${COLLECTION}&itemId=${ITEM_ID}`)).data[0]
      })

      it('should surface the newest order with its price', () => {
        expect(item).toMatchObject({ tradeId: NEWER_TRADE_ID, price: NEWER_PRICE, isPaused: false })
      })
    })

    describe('and fetching it from /v2/catalog', () => {
      let item: Row | undefined

      beforeEach(async () => {
        item = (await getJSON(`/v2/catalog?contractAddress=${COLLECTION}`)).data.find((row: Row) => row.itemId === ITEM_ID)
      })

      it('should surface the newest order with its price', () => {
        expect(item).toMatchObject({ tradeId: NEWER_TRADE_ID, price: NEWER_PRICE, isPaused: false })
      })
    })
  })

  describe('when an nft has an open secondary listing', () => {
    const COLLECTION = '0xb0b0000000000000000000000000000000000002'
    let tokenId: string

    beforeEach(async () => {
      tokenId = `${Date.now()}`
      await createSquidDBNFT(components, { tokenId, contractAddress: COLLECTION, owner: SELLER, category: NFTCategory.WEARABLE })
      tradeId = await createSquidDBTrade(components, {
        tokenId,
        contractAddress: COLLECTION,
        owner: SELLER,
        network: 'MATIC',
        marketplace: MARKETPLACE
      })
    })

    afterEach(async () => {
      await deleteSquidDBNFT(components, tokenId, COLLECTION)
    })

    describe('and its marketplace contract is paused', () => {
      beforeEach(async () => {
        await createSquidContractStatusRow(components, { address: MARKETPLACE, network: 'POLYGON', paused: true })
        await refreshTradesMaterializedView(components)
      })

      describe('and fetching it from /v1/orders', () => {
        let order: Row | null | undefined

        beforeEach(async () => {
          order = (await getJSON(`/v1/orders?contractAddress=${COLLECTION}&tokenId=${tokenId}&status=open`)).data.find(
            (row: Row) => row.tradeId === tradeId
          )
        })

        it('should keep it open and flag it as paused', () => {
          expect(order).toMatchObject({ tradeId, status: 'open', isPaused: true })
        })
      })

      describe('and fetching it from /v1/nfts', () => {
        let order: Row | null | undefined

        beforeEach(async () => {
          const nfts = (await getJSON<{ data: NFTRow[] }>(`/v1/nfts?contractAddress=${COLLECTION}&tokenId=${tokenId}`)).data
          order = nfts.find(row => row.nft.tokenId === tokenId)?.order
        })

        it('should embed the order flagged as paused', () => {
          expect(order).toMatchObject({ tradeId, status: 'open', isPaused: true })
        })
      })
    })

    describe('and its marketplace contract is not paused', () => {
      beforeEach(async () => {
        await refreshTradesMaterializedView(components)
      })

      describe('and fetching it from /v1/orders', () => {
        let order: Row | null | undefined

        beforeEach(async () => {
          order = (await getJSON(`/v1/orders?contractAddress=${COLLECTION}&tokenId=${tokenId}&status=open`)).data.find(
            (row: Row) => row.tradeId === tradeId
          )
        })

        it('should not flag it as paused', () => {
          expect(order).toMatchObject({ tradeId, status: 'open', isPaused: false })
        })
      })
    })
  })
})
