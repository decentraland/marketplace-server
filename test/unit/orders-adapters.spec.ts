import { ListingStatus, Network, NFTCategory, Order } from '@dcl/schemas'
import { fromDBOrderToOrder } from '../../src/adapters/orders'
import { fromSecondsToMilliseconds } from '../../src/logic/date'
import { DBOrder } from '../../src/ports/orders/types'
import { SquidNetwork, WithPaused } from '../../src/types'

describe('when converting a db order to an order', () => {
  let dbOrder: DBOrder
  let expectedOrder: WithPaused<Order>

  beforeEach(() => {
    dbOrder = {
      id: '123',
      marketplace_address: '0x123',
      nft_address: '0x456',
      token_id: '789',
      owner: '0xabc',
      buyer: '0xdef',
      price: '100',
      status: ListingStatus.OPEN,
      expires_at: Math.round(Date.now() / 1000),
      created_at: Date.now() / 1000,
      updated_at: Date.now() / 1000,
      network: SquidNetwork.ETHEREUM,
      issued_id: 'abc123',
      trade_id: 'def456',
      count: 1,
      category: NFTCategory.ENS,
      item_id: 'ghi789',
      nft_id: 'jkl012',
      paused: false
    }

    expectedOrder = {
      id: '123',
      marketplaceAddress: '0x123',
      contractAddress: '0x456',
      tokenId: '789',
      owner: '0xabc',
      buyer: '0xdef',
      price: '100',
      status: ListingStatus.OPEN,
      expiresAt: dbOrder.expires_at,
      createdAt: fromSecondsToMilliseconds(dbOrder.created_at),
      updatedAt: fromSecondsToMilliseconds(dbOrder.updated_at),
      network: Network.ETHEREUM,
      chainId: 1,
      issuedId: 'abc123',
      tradeId: 'def456',
      paused: false
    }
  })

  describe('and its marketplace contract is not paused', () => {
    it('should convert it to an order flagged as not paused', () => {
      expect(fromDBOrderToOrder(dbOrder)).toEqual(expectedOrder)
    })
  })

  describe('and its marketplace contract is paused', () => {
    beforeEach(() => {
      dbOrder = { ...dbOrder, paused: true }
      expectedOrder = { ...expectedOrder, paused: true }
    })

    it('should convert it to an open order flagged as paused', () => {
      expect(fromDBOrderToOrder(dbOrder)).toEqual(expectedOrder)
    })
  })
})
