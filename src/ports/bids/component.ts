import { GetBidsParameters } from '@dcl/schemas'
import { fromDBBidToBid } from '../../adapters/bids/bids'
import { AppComponents } from '../../types'
import { extractCount } from '../pagination'
import { getBidsCountQuery, getBidsQuery } from './queries'
import { DBBid, IBidsComponent } from './types'

export function createBidsComponents(components: Pick<AppComponents, 'dappsDatabase'>): IBidsComponent {
  const { dappsDatabase: pg } = components

  async function getBids(options: GetBidsParameters) {
    const [result, count] = await Promise.all([
      pg.query<DBBid>(getBidsQuery(options)),
      pg.query<{ count: string }>(getBidsCountQuery(options))
    ])

    return {
      data: result.rows.map(fromDBBidToBid),
      total: extractCount(count)
    }
  }

  return {
    getBids
  }
}
