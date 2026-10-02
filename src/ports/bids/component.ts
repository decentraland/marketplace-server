import { GetBidsParameters } from '@dcl/schemas'
import { fromDBBidToBid } from '../../adapters/bids/bids'
import { AppComponents } from '../../types'
import { getBidsQuery } from './queries'
import { DBBid, IBidsComponent } from './types'

export function createBidsComponents(components: Pick<AppComponents, 'dappsDatabase' | 'contractStatus'>): IBidsComponent {
  const { dappsDatabase: pg, contractStatus } = components

  async function getBids(options: GetBidsParameters) {
    const result = await pg.query<DBBid>(getBidsQuery(options, contractStatus.getPausedContracts()))

    return {
      data: result.rows.map(fromDBBidToBid),
      count: result.rows.length ? Number(result.rows[0].bids_count) : 0
    }
  }

  return {
    getBids
  }
}
