import { ChainId, NFTCategory } from '@dcl/schemas'
import * as chainIdUtils from '../../src/logic/chainIds'
import { test } from '../components'
import {
  clearSquidTradesRows,
  createSquidContractStatusRow,
  createSquidDBItem,
  createSquidDBItemOrderTrade,
  createSquidDBNFT,
  createSquidDBTrade,
  createSquidSignatureIndexRow,
  createSquidTradeActionRow,
  deleteSquidDBItem,
  deleteSquidDBNFT,
  deleteSquidDBTrade,
  refreshTradesMaterializedView
} from './utils/dbItems'

/**
 * A paused off-chain marketplace contract, read from the trades indexer's contract_status at query time.
 *
 * Product decision: a listing on a paused contract stays OPEN and visible everywhere, and keeps counting in
 * the catalogue aggregates; every representation only says so through `paused`. A contract signature index
 * bump, in contrast, cancels its trades, so they leave the open lists exactly like a signer cancellation.
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
      tradeId = await createSquidDBItemOrderTrade(components, {
        contractAddress: COLLECTION,
        itemId: ITEM_ID,
        signer: SELLER,
        marketplace: MARKETPLACE,
        network: 'MATIC'
      })
    })

    afterEach(async () => {
      await deleteSquidDBItem(components, ITEM_ID, COLLECTION)
    })

    describe('and its marketplace contract is paused', () => {
      beforeEach(async () => {
        // POLYGON, not MATIC: proves the network translation the join applies.
        await createSquidContractStatusRow(components, { address: MARKETPLACE, network: 'POLYGON', paused: true })
        await refreshTradesMaterializedView(components)
      })

      describe('and fetching it from /v1/items', () => {
        let item: Row | undefined

        beforeEach(async () => {
          item = (await getJSON(`/v1/items?contractAddress=${COLLECTION}&itemId=${ITEM_ID}`)).data[0]
        })

        it('should keep it on sale through the trade and flag it as paused', () => {
          expect(item).toMatchObject({ tradeId, tradeContractAddress: MARKETPLACE, isOnSale: true, paused: true })
        })
      })

      describe('and fetching it from /v2/catalog', () => {
        let item: Row | undefined

        beforeEach(async () => {
          item = (await getJSON(`/v2/catalog?contractAddress=${COLLECTION}`)).data.find((row: Row) => row.itemId === ITEM_ID)
        })

        it('should keep it on sale priced by the trade and flag it as paused', () => {
          expect(item).toMatchObject({ tradeId, isOnSale: true, price: '500000000000000000', paused: true })
        })
      })

      describe('and fetching it from /v3/catalog/items', () => {
        let item: Row | undefined

        beforeEach(async () => {
          item = (await getJSON(`/v3/catalog/items?contractAddress=${COLLECTION}`)).data.find((row: Row) => row.itemId === ITEM_ID)
        })

        it('should flag it as paused', () => {
          expect(item).toMatchObject({ tradeId, paused: true })
        })
      })

      describe('and fetching it from /v3/catalog/shop', () => {
        let listing: Row | undefined

        beforeEach(async () => {
          listing = (await getJSON(`/v3/catalog/shop?contractAddress=${COLLECTION}`)).data.find((row: Row) => row.tradeId === tradeId)
        })

        it('should keep the listing in the feed and flag it as paused', () => {
          expect(listing).toMatchObject({ tradeId, priceCredits: 5, paused: true })
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
          expect(listing).toMatchObject({ tradeId, source: 'native', paused: true })
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
          expect(item).toMatchObject({ tradeId, listingCount: 1, paused: true })
        })
      })

      describe('and fetching the trade from /v1/trades/:id', () => {
        let trade: Row | undefined

        beforeEach(async () => {
          trade = (await getJSON<{ data: Row }>(`/v1/trades/${tradeId}`)).data
        })

        it('should report it open and paused', () => {
          expect(trade).toMatchObject({ id: tradeId, status: 'open', paused: true })
        })
      })

      describe('and listing every trade from /v1/trades', () => {
        let trade: Row | undefined

        beforeEach(async () => {
          trade = (await getJSON<{ data: { data: Row[] } }>('/v1/trades')).data.data.find((row: Row) => row.id === tradeId)
        })

        it('should flag it as paused', () => {
          expect(trade).toMatchObject({ id: tradeId, paused: true })
        })
      })
    })

    describe('and its marketplace contract was unpaused', () => {
      beforeEach(async () => {
        await createSquidContractStatusRow(components, { address: MARKETPLACE, network: 'POLYGON', paused: false })
        await refreshTradesMaterializedView(components)
      })

      describe('and fetching it from /v1/items', () => {
        let item: Row | undefined

        beforeEach(async () => {
          item = (await getJSON(`/v1/items?contractAddress=${COLLECTION}&itemId=${ITEM_ID}`)).data[0]
        })

        it('should not flag it as paused', () => {
          expect(item).toMatchObject({ tradeId, isOnSale: true, paused: false })
        })
      })

      describe('and fetching it from /v2/catalog', () => {
        let item: Row | undefined

        beforeEach(async () => {
          item = (await getJSON(`/v2/catalog?contractAddress=${COLLECTION}`)).data.find((row: Row) => row.itemId === ITEM_ID)
        })

        it('should not flag it as paused', () => {
          expect(item).toMatchObject({ tradeId, paused: false })
        })
      })
    })

    describe('and the same contract is paused on another network only', () => {
      beforeEach(async () => {
        await createSquidContractStatusRow(components, { address: MARKETPLACE, network: 'ETHEREUM', paused: true })
        await refreshTradesMaterializedView(components)
      })

      describe('and fetching it from /v1/items', () => {
        let item: Row | undefined

        beforeEach(async () => {
          item = (await getJSON(`/v1/items?contractAddress=${COLLECTION}&itemId=${ITEM_ID}`)).data[0]
        })

        it('should not flag it as paused', () => {
          expect(item).toMatchObject({ tradeId, paused: false })
        })
      })
    })

    describe('and its marketplace contract bumps its contract signature index', () => {
      beforeEach(async () => {
        await createSquidSignatureIndexRow(components, { address: MARKETPLACE, contract: MARKETPLACE, network: 'POLYGON', index: 1 })
        await refreshTradesMaterializedView(components)
      })

      describe('and fetching it from /v1/items', () => {
        let item: Row | undefined

        beforeEach(async () => {
          item = (await getJSON(`/v1/items?contractAddress=${COLLECTION}&itemId=${ITEM_ID}`)).data[0]
        })

        it('should no longer surface the trade nor put the item on sale', () => {
          expect(item).toMatchObject({ tradeId: null, isOnSale: false, price: '0', paused: false })
        })
      })

      describe('and fetching it from /v2/catalog', () => {
        let item: Row | undefined

        beforeEach(async () => {
          item = (await getJSON(`/v2/catalog?contractAddress=${COLLECTION}`)).data.find((row: Row) => row.itemId === ITEM_ID)
        })

        // The catalogue omits tradeId unless a trade sets the price.
        it('should no longer put the item on sale nor surface the trade', () => {
          expect(item).toEqual(expect.objectContaining({ isOnSale: false, price: '0', paused: false }))
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

      describe('and fetching the trade from /v1/trades/:id', () => {
        let trade: Row | undefined

        beforeEach(async () => {
          trade = (await getJSON<{ data: Row }>(`/v1/trades/${tradeId}`)).data
        })

        it('should report it cancelled', () => {
          expect(trade).toMatchObject({ status: 'cancelled', paused: false })
        })
      })
    })
  })

  describe('when an nft has an open secondary listing', () => {
    const COLLECTION = '0xb0b0000000000000000000000000000000000002'
    let tokenId: string
    let signature: string

    beforeEach(async () => {
      tokenId = `${Date.now()}`
      signature = `paused-nft-order-${tokenId}`
      await createSquidDBNFT(components, { tokenId, contractAddress: COLLECTION, owner: SELLER, category: NFTCategory.WEARABLE })
      tradeId = await createSquidDBTrade(components, {
        tokenId,
        contractAddress: COLLECTION,
        owner: SELLER,
        signature,
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
          expect(order).toMatchObject({ tradeId, status: 'open', paused: true })
        })
      })

      describe('and fetching it from /v1/nfts', () => {
        let order: Row | null | undefined

        beforeEach(async () => {
          const nfts = (await getJSON<{ data: NFTRow[] }>(`/v1/nfts?contractAddress=${COLLECTION}&tokenId=${tokenId}`)).data
          order = nfts.find(row => row.nft.tokenId === tokenId)?.order
        })

        it('should embed the order flagged as paused', () => {
          expect(order).toMatchObject({ tradeId, status: 'open', paused: true })
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
          expect(order).toMatchObject({ tradeId, status: 'open', paused: false })
        })
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
        await createSquidSignatureIndexRow(components, { address: MARKETPLACE, contract: MARKETPLACE, network: 'POLYGON', index: 1 })
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
})
