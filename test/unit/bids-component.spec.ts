import { ChainId, Network } from '@dcl/schemas'
import { fromDBBidToBid } from '../../src/adapters/bids/bids'
import { DBBid, IBidsComponent, createBidsComponents } from '../../src/ports/bids'
import { IPgComponent } from '../../src/ports/db/types'
import { createTestPgComponent } from '../components'

describe('when fetching bids', () => {
  let bidsComponent: IBidsComponent
  let pgComponent: IPgComponent

  describe('and there are no bids for the specified filters', () => {
    beforeEach(() => {
      pgComponent = createTestPgComponent()
      ;(pgComponent.query as jest.Mock).mockResolvedValue({ rows: [], count: 0 })
      bidsComponent = createBidsComponents({ dappsDatabase: pgComponent })
    })

    it('should return empty data with 0 count', async () => {
      expect(await bidsComponent.getBids({ limit: 10, offset: 0 })).toEqual({ data: [], count: 0 })
    })
  })

  describe('and there are bids for the specified filters', () => {
    let bids: DBBid[]

    beforeEach(() => {
      bids = [
        {
          count: 10,
          trade_id: '1',
          price: '10',
          token_id: '1',
          created_at: new Date(),
          updated_at: new Date(),
          network: Network.ETHEREUM,
          chain_id: ChainId.ETHEREUM_SEPOLIA,
          bidder: '0x1',
          contract_address: '0x1',
          expires_at: new Date(),
          item_id: null,
          fingerprint: '123'
        }
      ]
      pgComponent = createTestPgComponent()
      ;(pgComponent.query as jest.Mock).mockResolvedValue({ rows: bids, count: 1 })
      bidsComponent = createBidsComponents({ dappsDatabase: pgComponent })
    })

    it('should return the bids with the count', async () => {
      expect(await bidsComponent.getBids({ limit: 1, offset: 0 })).toEqual({ data: [fromDBBidToBid(bids[0])], count: bids[0].count })
    })
  })
})
