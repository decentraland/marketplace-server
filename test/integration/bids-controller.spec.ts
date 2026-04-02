import { ChainId, ListingStatus } from '@dcl/schemas'
import * as chainIdUtils from '../../src/logic/chainIds'
import * as tradeUtils from '../../src/logic/trades/utils'
import { test } from '../components'
import { createBidViaAPI } from './utils/bids'
import {
  createSquidDBBidTrade,
  createSquidDBLegacyBid,
  createSquidDBNFT,
  deleteSquidDBLegacyBid,
  deleteSquidDBNFT,
  deleteSquidDBTrade
} from './utils/dbItems'

test('bids controller', function ({ components }) {
  beforeEach(() => {
    jest.spyOn(tradeUtils, 'validateTradeSignature').mockImplementation(() => true)
    jest.spyOn(chainIdUtils, 'getEthereumChainId').mockReturnValue(ChainId.ETHEREUM_SEPOLIA)
    jest.spyOn(chainIdUtils, 'getPolygonChainId').mockReturnValue(ChainId.MATIC_AMOY)
  })

  describe('when fetching bids', () => {
    describe('and there are no matching bids', () => {
      it('should respond with a 200 and an empty result', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/v1/bids?contractAddress=0xnonexistent&status=open&limit=10&offset=0')
        const body = await response.json()
        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.data.results).toEqual([])
        expect(body.data.total).toBe(0)
      })
    })

    describe('and there is a trade-based bid on an NFT', () => {
      let tradeId: string
      let signer: string
      const contractAddress = '0x9d32aac179153a991e832550d9f96441ea27763b'
      const tokenId = '200'

      beforeEach(async () => {
        const result = await createBidViaAPI(components, { contractAddress, tokenId, price: '500' })
        tradeId = result.tradeId
        signer = result.signer
      })

      afterEach(async () => {
        await deleteSquidDBTrade(components, tradeId)
      })

      describe('and filtering by contractAddress and tokenId', () => {
        it('should respond with a 200 and the matching bid', async () => {
          const { localFetch } = components
          const response = await localFetch.fetch(
            `/v1/bids?contractAddress=${contractAddress}&tokenId=${tokenId}&status=${ListingStatus.OPEN}&limit=10&offset=0`
          )
          const body = await response.json()
          expect(response.status).toBe(200)
          expect(body.ok).toBe(true)
          expect(body.data.results).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                tradeId,
                contractAddress,
                tokenId,
                bidder: signer,
                price: '500'
              })
            ])
          )
        })
      })

      describe('and filtering by bidder', () => {
        it('should respond with a 200 and the bid for that bidder', async () => {
          const { localFetch } = components
          const response = await localFetch.fetch(`/v1/bids?bidder=${signer}&status=${ListingStatus.OPEN}&limit=10&offset=0`)
          const body = await response.json()
          expect(response.status).toBe(200)
          expect(body.data.results).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                tradeId,
                bidder: signer
              })
            ])
          )
        })
      })
    })

    describe('and there is a legacy bid', () => {
      let legacyBidId: string
      const contractAddress = '0xlegacycontract0000000000000000000000001'
      const tokenId = '300'
      const bidderHex = '1234567890123456789012345678901234567890'

      beforeEach(async () => {
        legacyBidId = await createSquidDBLegacyBid(components, {
          contractAddress,
          tokenId,
          bidder: bidderHex,
          price: '750',
          status: 'open',
          network: 'matic'
        })
      })

      afterEach(async () => {
        await deleteSquidDBLegacyBid(components, legacyBidId)
      })

      it('should respond with a 200 and the legacy bid', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch(
          `/v1/bids?contractAddress=${contractAddress}&tokenId=${tokenId}&status=open&limit=10&offset=0`
        )
        const body = await response.json()
        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.data.results).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: legacyBidId,
              contractAddress,
              tokenId,
              bidder: `0x${bidderHex}`,
              price: '750'
            })
          ])
        )
      })
    })

    describe('and there are multiple bids with pagination', () => {
      let tradeIds: string[]
      const contractAddress = '0xaaaa000000000000000000000000000000000001'

      beforeEach(async () => {
        tradeIds = []
        for (let i = 0; i < 3; i++) {
          const result = await createBidViaAPI(components, {
            contractAddress,
            tokenId: `${500 + i}`,
            price: `${(i + 1) * 100}`
          })
          tradeIds.push(result.tradeId)
        }
      })

      afterEach(async () => {
        for (const id of tradeIds) {
          await deleteSquidDBTrade(components, id)
        }
      })

      it('should respond with the limited results and the correct total count', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch(`/v1/bids?contractAddress=${contractAddress}&status=${ListingStatus.OPEN}&limit=2&offset=0`)
        const body = await response.json()
        expect(response.status).toBe(200)
        expect(body.data.results.length).toBe(2)
        expect(body.data.total).toBe(3)
      })
    })

    describe('and there is a trade-based bid on a collection item', () => {
      let tradeId: string
      const contractAddress = '0xbbbb000000000000000000000000000000000001'
      const itemId = '42'
      const bidder = '0xcccc000000000000000000000000000000000001'

      beforeEach(async () => {
        tradeId = await createSquidDBBidTrade(components, {
          contractAddress,
          itemId,
          bidder,
          price: '999'
        })
      })

      afterEach(async () => {
        await deleteSquidDBTrade(components, tradeId)
      })

      describe('and filtering by contractAddress and itemId', () => {
        it('should respond with a 200 and the item bid', async () => {
          const { localFetch } = components
          const response = await localFetch.fetch(
            `/v1/bids?contractAddress=${contractAddress}&itemId=${itemId}&status=${ListingStatus.OPEN}&limit=10&offset=0`
          )
          const body = await response.json()
          expect(response.status).toBe(200)
          expect(body.data.results.length).toBe(1)
          expect(body.data.results[0]).toEqual(
            expect.objectContaining({
              tradeId: expect.any(String),
              contractAddress,
              itemId,
              bidder,
              price: '999'
            })
          )
        })
      })

      describe('and there is also a legacy bid for the same contract', () => {
        let legacyBidId: string

        beforeEach(async () => {
          legacyBidId = await createSquidDBLegacyBid(components, {
            contractAddress,
            tokenId: '1',
            price: '500',
            status: 'open'
          })
        })

        afterEach(async () => {
          await deleteSquidDBLegacyBid(components, legacyBidId)
        })

        it('should exclude the legacy bid and only return the trade bid', async () => {
          const { localFetch } = components
          const response = await localFetch.fetch(
            `/v1/bids?contractAddress=${contractAddress}&itemId=${itemId}&status=${ListingStatus.OPEN}&limit=10&offset=0`
          )
          const body = await response.json()
          expect(response.status).toBe(200)
          expect(body.data.total).toBe(1)
          expect(body.data.results[0]).toEqual(expect.objectContaining({ tradeId: expect.any(String) }))
        })
      })
    })

    describe('and there are bids from both sources for the same contract and token', () => {
      let tradeId: string
      let legacyBidId: string
      const contractAddress = '0xdddd000000000000000000000000000000000001'
      const tokenId = '700'
      const tradeBidder = '0xeeee000000000000000000000000000000000001'
      const legacyBidderHex = 'ffff000000000000000000000000000000000001'

      beforeEach(async () => {
        tradeId = await createSquidDBBidTrade(components, {
          contractAddress,
          tokenId,
          bidder: tradeBidder,
          price: '1000'
        })
        legacyBidId = await createSquidDBLegacyBid(components, {
          contractAddress,
          tokenId,
          bidder: legacyBidderHex,
          price: '2000',
          status: 'open'
        })
      })

      afterEach(async () => {
        await deleteSquidDBTrade(components, tradeId)
        await deleteSquidDBLegacyBid(components, legacyBidId)
      })

      it('should respond with a 200 and bids from both sources', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch(
          `/v1/bids?contractAddress=${contractAddress}&tokenId=${tokenId}&status=${ListingStatus.OPEN}&limit=10&offset=0`
        )
        const body = await response.json()
        expect(response.status).toBe(200)
        expect(body.data.total).toBe(2)
        expect(body.data.results).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              tradeId: expect.any(String),
              bidder: tradeBidder,
              price: '1000'
            }),
            expect.objectContaining({
              id: legacyBidId,
              bidder: `0x${legacyBidderHex}`,
              price: '2000'
            })
          ])
        )
      })
    })

    describe('and there are expired bids', () => {
      let activeBidId: string
      let expiredLegacyBidId: string
      let expiredTradeId: string
      const contractAddress = '0x1111000000000000000000000000000000000001'
      const tokenId = '800'

      beforeEach(async () => {
        activeBidId = await createSquidDBLegacyBid(components, {
          contractAddress,
          tokenId,
          price: '100',
          status: 'open'
        })
        expiredLegacyBidId = await createSquidDBLegacyBid(components, {
          contractAddress,
          tokenId,
          bidder: 'aaaa000000000000000000000000000000000001',
          price: '200',
          status: 'open',
          expiresAt: Date.now() - 86400000
        })
        expiredTradeId = await createSquidDBBidTrade(components, {
          contractAddress,
          tokenId,
          bidder: '0x2222000000000000000000000000000000000001',
          price: '300',
          expiresInMs: -86400000
        })
      })

      afterEach(async () => {
        await deleteSquidDBLegacyBid(components, activeBidId)
        await deleteSquidDBLegacyBid(components, expiredLegacyBidId)
        await deleteSquidDBTrade(components, expiredTradeId)
      })

      it('should respond with a 200 and only the non-expired bid', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch(
          `/v1/bids?contractAddress=${contractAddress}&tokenId=${tokenId}&status=${ListingStatus.OPEN}&limit=10&offset=0`
        )
        const body = await response.json()
        expect(response.status).toBe(200)
        expect(body.data.total).toBe(1)
        expect(body.data.results[0]).toEqual(
          expect.objectContaining({
            id: activeBidId,
            price: '100'
          })
        )
      })
    })

    describe('and there are bids with different statuses', () => {
      let openBidId: string
      let cancelledBidId: string
      const contractAddress = '0x3333000000000000000000000000000000000001'
      const tokenId = '900'

      beforeEach(async () => {
        openBidId = await createSquidDBLegacyBid(components, {
          contractAddress,
          tokenId,
          price: '100',
          status: 'open'
        })
        cancelledBidId = await createSquidDBLegacyBid(components, {
          contractAddress,
          tokenId,
          bidder: 'bbbb000000000000000000000000000000000001',
          price: '200',
          status: 'cancelled'
        })
      })

      afterEach(async () => {
        await deleteSquidDBLegacyBid(components, openBidId)
        await deleteSquidDBLegacyBid(components, cancelledBidId)
      })

      describe('and filtering by open status', () => {
        it('should respond with a 200 and only the open bid', async () => {
          const { localFetch } = components
          const response = await localFetch.fetch(
            `/v1/bids?contractAddress=${contractAddress}&tokenId=${tokenId}&status=${ListingStatus.OPEN}&limit=10&offset=0`
          )
          const body = await response.json()
          expect(response.status).toBe(200)
          expect(body.data.total).toBe(1)
          expect(body.data.results[0]).toEqual(
            expect.objectContaining({
              id: openBidId,
              price: '100'
            })
          )
        })
      })
    })

    describe('and there is a trade bid with an NFT owner as seller', () => {
      let tradeId: string
      const contractAddress = '0x4444000000000000000000000000000000000001'
      const tokenId = '950'
      const nftOwner = '0x5555000000000000000000000000000000000001'
      const bidder = '0x6666000000000000000000000000000000000001'

      beforeEach(async () => {
        await createSquidDBNFT(components, {
          contractAddress,
          tokenId,
          owner: nftOwner,
          network: 'matic'
        })
        tradeId = await createSquidDBBidTrade(components, {
          contractAddress,
          tokenId,
          bidder,
          price: '1200',
          network: 'matic'
        })
      })

      afterEach(async () => {
        await deleteSquidDBTrade(components, tradeId)
        await deleteSquidDBNFT(components, tokenId, contractAddress)
      })

      describe('and filtering by the matching seller', () => {
        it('should respond with a 200 and the bid with the seller populated', async () => {
          const { localFetch } = components
          const response = await localFetch.fetch(`/v1/bids?seller=${nftOwner}&status=${ListingStatus.OPEN}&limit=10&offset=0`)
          const body = await response.json()
          expect(response.status).toBe(200)
          expect(body.data.results).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                tradeId: expect.any(String),
                contractAddress,
                tokenId,
                bidder,
                seller: nftOwner,
                price: '1200'
              })
            ])
          )
        })
      })

      describe('and filtering by a non-matching seller', () => {
        it('should respond with a 200 and not include the bid', async () => {
          const { localFetch } = components
          const response = await localFetch.fetch(
            `/v1/bids?seller=0x0000000000000000000000000000000000000099&status=${ListingStatus.OPEN}&limit=10&offset=0`
          )
          const body = await response.json()
          expect(response.status).toBe(200)
          expect(body.data.results).not.toEqual(expect.arrayContaining([expect.objectContaining({ tradeId })]))
        })
      })
    })
  })
})
